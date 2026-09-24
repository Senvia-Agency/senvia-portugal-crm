import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SaleItemWithProduct } from "@/types/sales";

export function useSaleItems(saleId: string | undefined) {
  return useQuery({
    queryKey: ["sale-items", saleId],
    queryFn: async (): Promise<SaleItemWithProduct[]> => {
      if (!saleId) return [];

      const { data, error } = await supabase
        .from("sale_items")
        .select(`
          *,
          product:products(name, price, is_recurring, tax_value, tax_exemption_reason, price_includes_vat, retention_rate)
        `)
        .eq("sale_id", saleId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data as unknown as SaleItemWithProduct[]) || [];
    },
    enabled: !!saleId,
  });
}

export function useCreateSaleItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: {
      sale_id: string;
      product_id?: string | null;
      name: string;
      quantity: number;
      unit_price: number;
      total: number;
      first_due_date?: string | null;
      discount_percent?: number;
      tax_value?: number | null;
      tax_exemption_reason?: string | null;
      price_includes_vat?: boolean | null;
      retention_rate?: number | null;
      stripe_price_id?: string | null;
    }[]) => {
      if (items.length === 0) return [];

      const { data, error } = await supabase
        .from("sale_items")
        .insert(items)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      if (variables.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["sale-items", variables[0].sale_id] });
      }
    },
  });
}

export function useUpdateSaleItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      itemId, 
      saleId,
      updates 
    }: { 
      itemId: string; 
      saleId: string;
      updates: { 
        quantity?: number; 
        unit_price?: number; 
        total?: number;
        name?: string;
        first_due_date?: string | null;
      } 
    }) => {
      const { error } = await supabase
        .from("sale_items")
        .update(updates)
        .eq("id", itemId);

      if (error) throw error;
      return { saleId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sale-items", data.saleId] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
    },
  });
}

export function useDeleteSaleItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, saleId }: { itemId: string; saleId: string }) => {
      const { error } = await supabase
        .from("sale_items")
        .delete()
        .eq("id", itemId);

      if (error) throw error;
      return { saleId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sale-items", data.saleId] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
    },
  });
}
