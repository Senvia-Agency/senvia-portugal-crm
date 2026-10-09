import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type BdsFinanceSchema = {
  public: {
    Tables: {
      bds_sara_org_commission: {
        Row: { sale_id: string; organization_id: string; user_id: string; amount: number; updated_at: string; paid_at: string | null };
        Insert: { sale_id: string; organization_id: string; user_id: string; amount: number; updated_at?: string; paid_at?: string | null };
        Update: Partial<{ sale_id: string; organization_id: string; user_id: string; amount: number; updated_at: string; paid_at: string | null }>;
        Relationships: [];
      };
      bds_manual_chargebacks: {
        Row: { id: string; organization_id: string; user_id: string; client_id: string | null; client_name: string | null; amount: number; reason: 'manual'; status: 'pending' | 'reconciled' | 'dismissed'; application_month: string | null; applied_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; user_id: string; client_id?: string | null; client_name?: string | null; amount: number; reason?: 'manual'; status?: 'pending' | 'reconciled' | 'dismissed'; application_month?: string | null; applied_at?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<{ id: string; organization_id: string; user_id: string; client_id: string | null; client_name: string | null; amount: number; reason: 'manual'; status: 'pending' | 'reconciled' | 'dismissed'; application_month: string | null; applied_at: string | null; created_at: string; updated_at?: string }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export const bdsFinanceSupabase = supabase as unknown as SupabaseClient<BdsFinanceSchema>;
