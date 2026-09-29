import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { useToast } from '@/hooks/use-toast';
import { validateServicosDetails } from '@/lib/proposal-servicos-validation';
import type { Proposal, ProposalProduct, ProposalStatus } from '@/types/proposals';

export function useProposals() {
  const { organization } = useAuth();
  const { effectiveUserIds } = useTeamFilter();

  return useQuery({
    queryKey: ['proposals', organization?.id, effectiveUserIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposals')
        .select(`
          *,
          lead:leads(id, name, email, phone, assigned_to),
          client:crm_clients(id, name, email, phone),
          linked_sales:sales!sales_proposal_id_fkey(id)
        `)
        .eq('organization_id', organization!.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      let result = (data as any[]).map(({ linked_sales, ...rest }) => ({
        ...rest,
        has_sale: Array.isArray(linked_sales) && linked_sales.length > 0,
      })) as (Proposal & { lead?: { assigned_to?: string }; has_sale?: boolean })[];
      
      // Filter by user IDs (admin/leader/single user)
      if (effectiveUserIds) {
        result = result.filter(proposal => 
          (proposal.created_by && effectiveUserIds.includes(proposal.created_by)) || 
          (proposal.lead?.assigned_to && effectiveUserIds.includes(proposal.lead.assigned_to))
        );
      }
      
      return result as (Proposal & { has_sale?: boolean })[];
    },
    enabled: !!organization?.id,
  });
}

export function useLeadProposals(leadId: string | undefined) {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['proposals', 'lead', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposals')
        .select(`
          *,
          lead:leads(id, name, email, phone),
          client:crm_clients(id, name, email, phone)
        `)
        .eq('lead_id', leadId!)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Proposal[];
    },
    enabled: !!leadId && !!organization?.id,
  });
}

export function useProposalProducts(proposalId: string | undefined) {
  return useQuery({
    queryKey: ['proposal_products', proposalId],
    queryFn: async () => {
      // Get proposal products
      const { data: proposalProducts, error: ppError } = await supabase
        .from('proposal_products')
        .select('*')
        .eq('proposal_id', proposalId!);
      
      if (ppError) throw ppError;
      if (!proposalProducts || proposalProducts.length === 0) return [];
      
      // Get product details for each product_id
      const productIds = proposalProducts.map(pp => pp.product_id);
      const { data: products, error: pError } = await supabase
        .from('products')
        .select('id, name, price')
        .in('id', productIds);
      
      if (pError) throw pError;
      
      // Merge products into proposal_products
      const productsMap = new Map(products?.map(p => [p.id, p]) || []);
      
      return proposalProducts.map(pp => ({
        ...pp,
        product: productsMap.get(pp.product_id) || null,
      })) as (ProposalProduct & { product?: { id: string; name: string; price: number } | null })[];
    },
    enabled: !!proposalId,
  });
}

interface CreateProposalData {
  client_id?: string;
  lead_id?: string;
  total_value: number;
  status?: ProposalStatus;
  notes?: string;
  proposal_date?: string;
  products: { product_id: string; quantity: number; unit_price: number; total: number }[];
  
  // Campos por tipo de proposta
  proposal_type?: 'energia' | 'servicos';
  negotiation_type?: 'angariacao' | 'angariacao_indexado' | 'renovacao' | 'sem_volume';
  
  // Campos Energia (legacy)
  consumo_anual?: number;
  margem?: number;
  dbl?: number;
  anos_contrato?: number;
  
  // Campos Serviços
  modelo_servico?: 'transacional' | 'saas';
  kwp?: number;
  servicos_produtos?: string[];
  servicos_details?: Record<string, any>;
  
  // Comum
  comissao?: number;
  documents_checked?: boolean;
  contract_signed?: boolean;
}

export function useCreateProposal() {
  const queryClient = useQueryClient();
  const { organization, user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateProposalData) => {
      // Guardrail: validate servicos details before insert
      if (data.proposal_type === 'servicos' && data.servicos_produtos?.length) {
        const errors = validateServicosDetails(data.servicos_produtos, data.servicos_details || {});
        if (errors.length > 0) {
          throw new Error(errors[0].message);
        }
      }

      // Auto-infer lead_id from client if not provided
      let leadId = data.lead_id || null;
      
      if (!leadId && data.client_id) {
        // Lookup client to get its lead_id
        const { data: client } = await supabase
          .from('crm_clients')
          .select('lead_id')
          .eq('id', data.client_id)
          .single();
        
        if (client?.lead_id) {
          leadId = client.lead_id;
        }
      }
      
      // Create proposal
      const { data: proposal, error: proposalError } = await supabase
        .from('proposals')
        .insert({
          organization_id: organization!.id,
          client_id: data.client_id || null,
          lead_id: leadId,
          total_value: data.total_value,
          status: data.status || 'draft',
          notes: data.notes || null,
          proposal_date: data.proposal_date || new Date().toISOString().split('T')[0],
          created_by: user?.id,
          // Campos por tipo
          proposal_type: data.proposal_type || null,
          negotiation_type: data.negotiation_type || null,
          consumo_anual: data.consumo_anual || null,
          margem: data.margem || null,
          dbl: data.dbl ?? null,
          anos_contrato: data.anos_contrato || null,
          modelo_servico: data.modelo_servico || null,
          kwp: data.kwp || null,
          comissao: data.comissao || null,
          servicos_produtos: data.servicos_produtos || null,
          servicos_details: data.servicos_details || null,
          documents_checked: data.documents_checked ?? false,
          contract_signed: data.contract_signed ?? false,
        })
        .select(`
          *,
          client:crm_clients(id, name, email, phone),
          lead:leads(id, name, email, phone)
        `)
        .single();
      
      if (proposalError) throw proposalError;

      // Create proposal products
      if (data.products.length > 0) {
        const { error: productsError } = await supabase
          .from('proposal_products')
          .insert(
            data.products.map(p => ({
              proposal_id: proposal.id,
              product_id: p.product_id,
              quantity: p.quantity,
              unit_price: p.unit_price,
              total: p.total,
            }))
          );
        
        if (productsError) throw productsError;
      }

      return proposal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      toast({ title: 'Proposta criada', description: 'A proposta foi criada com sucesso.' });
    },
    onError: () => {
      toast({ title: 'Erro', description: 'Não foi possível criar a proposta.', variant: 'destructive' });
    },
  });
}

interface UpdateProposalData {
  id: string;
  client_id?: string | null;
  total_value?: number;
  status?: ProposalStatus;
  notes?: string | null;
  proposal_date?: string;
  accepted_at?: string | null;
  proposal_type?: 'energia' | 'servicos';
  negotiation_type?: 'angariacao' | 'angariacao_indexado' | 'renovacao' | 'sem_volume' | null;
  consumo_anual?: number | null;
  margem?: number | null;
  dbl?: number | null;
  anos_contrato?: number | null;
  modelo_servico?: 'transacional' | 'saas' | null;
  kwp?: number | null;
  comissao?: number | null;
  servicos_produtos?: string[] | null;
  servicos_details?: Record<string, any> | null;
  documents_checked?: boolean | null;
  contract_signed?: boolean | null;
}

export function useUpdateProposal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateProposalData) => {
      // Guardrail: validate servicos details before update
      if (data.proposal_type === 'servicos' && data.servicos_produtos?.length) {
        const errors = validateServicosDetails(data.servicos_produtos, data.servicos_details || {});
        if (errors.length > 0) {
          throw new Error(errors[0].message);
        }
      }

      const payload = {
        ...data,
        ...(data.status === 'accepted' && data.accepted_at === undefined
          ? { accepted_at: new Date().toISOString() }
          : {}),
      };

      const { error } = await supabase
        .from('proposals')
        .update(payload)
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      toast({ title: 'Proposta atualizada', description: 'As alterações foram guardadas.' });
    },
    onError: () => {
      toast({ title: 'Erro', description: 'Não foi possível atualizar a proposta.', variant: 'destructive' });
    },
  });
}

export function useUpdateProposalProducts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ proposalId, products }: { 
      proposalId: string; 
      products: { product_id: string; quantity: number; unit_price: number; total: number }[] 
    }) => {
      // Empty lines can mean the edit form has not finished loading. Never
      // delete saved proposal products in that state.
      if (products.length === 0) throw new Error('A proposta não tem produtos para guardar');
      const { data: existing, error: readError } = await supabase
        .from('proposal_products')
        .select('id, product_id')
        .eq('proposal_id', proposalId);
      if (readError) throw readError;

      const remaining = new Map<string, string>();
      for (const row of existing ?? []) remaining.set(row.product_id, row.id);
      const keptIds = new Set<string>();
      const newProducts: typeof products = [];

      // Update rows in place, then insert additions. Existing rows are never
      // removed before all replacement data has been saved successfully.
      for (const product of products) {
        const id = remaining.get(product.product_id);
        if (!id) {
          newProducts.push(product);
          continue;
        }
        const { error } = await supabase
          .from('proposal_products')
          .update({
            quantity: product.quantity,
            unit_price: product.unit_price,
            total: product.total,
          })
          .eq('id', id)
          .eq('proposal_id', proposalId);
        if (error) throw error;
        keptIds.add(id);
      }

      if (newProducts.length > 0) {
        const { error } = await supabase.from('proposal_products').insert(
          newProducts.map(product => ({
            proposal_id: proposalId,
            product_id: product.product_id,
            quantity: product.quantity,
            unit_price: product.unit_price,
            total: product.total,
          }))
        );
        if (error) throw error;
      }

      const obsoleteIds = (existing ?? []).filter(row => !keptIds.has(row.id)).map(row => row.id);
      if (obsoleteIds.length > 0) {
        const { error } = await supabase
          .from('proposal_products')
          .delete()
          .eq('proposal_id', proposalId)
          .in('id', obsoleteIds);
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['proposal_products', variables.proposalId] });
    },
    onError: () => {
      toast({ title: 'Erro', description: 'Não foi possível atualizar os produtos.', variant: 'destructive' });
    },
  });
}

export function useDeleteProposal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('proposals')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      toast({ title: 'Proposta eliminada', description: 'A proposta foi removida.' });
    },
    onError: () => {
      toast({ title: 'Erro', description: 'Não foi possível eliminar a proposta.', variant: 'destructive' });
    },
  });
}
