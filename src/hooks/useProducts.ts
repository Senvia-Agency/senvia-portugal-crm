import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Product } from '@/types/proposals';
import { effectiveProductTaxRate, effectiveTaxExemptionReason, type OrganizationTaxConfig } from '@/lib/product-fiscal';

interface ProductMutationFields {
  name?: string;
  description?: string | null;
  price?: number | null;
  is_active?: boolean;
  is_recurring?: boolean;
  tax_value?: number | null;
  tax_exemption_reason?: string | null;
  price_includes_vat?: boolean;
  retention_rate?: number;
  invoicexpress_id?: number | null;
  commission_value?: number | null;
  commission_renewal_value?: number | null;
}

function validateFiscalFields(
  data: ProductMutationFields,
  organizationTaxConfig: OrganizationTaxConfig | null | undefined,
) {
  if (data.tax_value != null && (!Number.isFinite(data.tax_value) || data.tax_value < 0 || data.tax_value > 100)) {
    throw new Error('A taxa de IVA tem de estar entre 0% e 100%.');
  }
  if (data.retention_rate != null && (!Number.isFinite(data.retention_rate) || data.retention_rate < 0 || data.retention_rate > 100)) {
    throw new Error('A retenção tem de estar entre 0% e 100%.');
  }
  if (
    effectiveProductTaxRate(data.tax_value, organizationTaxConfig) === 0
    && !effectiveTaxExemptionReason(data.tax_exemption_reason, organizationTaxConfig)
  ) {
    throw new Error('Seleciona o motivo de isenção para um produto com IVA a 0%.');
  }
}

export function useProducts() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['products', organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('organization_id', organization!.id)
        .order('name');
      
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!organization?.id,
  });
}

export function useActiveProducts() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['products', 'active', organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('organization_id', organization!.id)
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!organization?.id,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: ProductMutationFields & { name: string }): Promise<Product> => {
      const organizationTaxConfig = organization?.tax_config as OrganizationTaxConfig | null | undefined;
      validateFiscalFields(data, organizationTaxConfig);
      const { data: inserted, error } = await supabase
        .from('products')
        .insert({
          organization_id: organization!.id,
          name: data.name,
          description: data.description || null,
          price: data.price ?? null,
          is_recurring: data.is_recurring ?? false,
          tax_value: data.tax_value ?? null,
          tax_exemption_reason: data.tax_exemption_reason || null,
          price_includes_vat: data.price_includes_vat ?? false,
          retention_rate: data.retention_rate ?? 0,
          commission_value: data.commission_value ?? null,
          commission_renewal_value: data.commission_renewal_value ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return inserted as Product;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'Produto criado', description: 'O produto foi adicionado com sucesso.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erro', description: error.message || 'Não foi possível criar o produto.', variant: 'destructive' });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...data }: ProductMutationFields & { id: string }) => {
      const organizationTaxConfig = organization?.tax_config as OrganizationTaxConfig | null | undefined;
      const changesFiscalFields = 'tax_value' in data
        || 'tax_exemption_reason' in data
        || 'price_includes_vat' in data
        || 'retention_rate' in data;
      if (changesFiscalFields) validateFiscalFields(data, organizationTaxConfig);
      const { data: updatedProduct, error } = await supabase
        .from('products')
        .update(data)
        .eq('id', id)
        .select('is_active, is_recurring')
        .single();
      
      if (error) throw error;

      // Sync to InvoiceXpress if product has invoicexpress_id
      const ixId = data.invoicexpress_id;
      let invoicingSync: boolean | null = null;
      let invoicingWarning: string | undefined;
      if (ixId && organization?.id) {
        try {
          const response = await supabase.functions.invoke('update-invoicexpress-item', {
            body: {
              organization_id: organization.id,
              invoicexpress_id: ixId,
              name: data.name,
              description: data.description,
              unit_price: data.price,
              tax_value: data.tax_value,
            },
          });
          if (response.error) throw new Error(response.error.message);
          invoicingSync = true;
          invoicingWarning = response.data?.warning;
        } catch (syncErr) {
          console.warn('InvoiceXpress sync failed:', syncErr);
          invoicingSync = false;
        }
      }

      // An active Stripe mapping must follow price/IVA changes immediately.
      // Otherwise the catalog says one amount while live subscriptions keep
      // charging the old one indefinitely.
      let stripeSync: boolean | null = null;
      if (organization?.id) {
        const { data: stripeMapping } = await supabase
          .from('stripe_product_mappings')
          .select('active')
          .eq('organization_id', organization.id)
          .eq('product_id', id)
          .maybeSingle();
        if (stripeMapping?.active) {
          try {
            const action = updatedProduct.is_active && updatedProduct.is_recurring ? 'sync' : 'disable';
            const response = await supabase.functions.invoke('stripe-product-sync', {
              body: { productId: id, action },
            });
            if (response.error || response.data?.error) {
              throw new Error(response.data?.error || response.error?.message);
            }
            stripeSync = true;
          } catch (syncErr) {
            console.warn('Stripe product sync failed:', syncErr);
            stripeSync = false;
          }
        }
      }

      return { synced: invoicingSync, warning: invoicingWarning, stripeSynced: stripeSync };
    },
    onSuccess: (_result) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stripe-product-mappings', organization?.id] });
      const result = _result as { synced: boolean | null; warning?: string; stripeSynced?: boolean | null } | undefined;
      if (result?.stripeSynced === false || result?.synced === false) {
        const failedServices = [
          result.synced === false ? 'InvoiceXpress' : null,
          result.stripeSynced === false ? 'Stripe' : null,
        ].filter(Boolean).join(' e ');
        toast({ title: 'Produto atualizado', description: `Guardado localmente, mas falhou a sincronização com ${failedServices}.`, variant: 'destructive' });
      } else if (result?.synced === true || result?.stripeSynced === true) {
        const syncedServices = [
          result.synced === true ? 'InvoiceXpress' : null,
          result.stripeSynced === true ? 'Stripe' : null,
        ].filter(Boolean).join(' e ');
        toast({ title: 'Produto atualizado', description: result.warning || `Sincronizado com ${syncedServices}.` });
      } else {
        toast({ title: 'Produto atualizado', description: 'As alterações foram guardadas.' });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Erro', description: error.message || 'Não foi possível atualizar o produto.', variant: 'destructive' });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'Produto eliminado', description: 'O produto foi removido.' });
    },
    onError: () => {
      toast({ title: 'Erro', description: 'Não foi possível eliminar o produto.', variant: 'destructive' });
    },
  });
}
