import { Lead } from "@/types";

export type ClientStatus = 'active' | 'inactive' | 'vip';
export type ClientSource = 'lead' | 'referral' | 'direct' | 'website' | 'other';
export type BillingTarget = 'client' | 'company';

export interface CrmClient {
  id: string;
  organization_id: string;
  code?: string | null;
  lead_id?: string | null;
  assigned_to?: string | null;
  
  // Basic info
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  nif?: string | null;
  company_nif?: string | null;
  company_address_same_as_client?: boolean;
  company_address_line1?: string | null;
  company_address_line2?: string | null;
  company_city?: string | null;
  company_postal_code?: string | null;
  company_country?: string | null;
  billing_target?: BillingTarget;
  
  // Address
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;

  // Telecom/Energy fields
  distrito?: string | null;
  conselho?: string | null;
  grupo_economico?: string | null;
  
  status: ClientStatus;
  source?: string | null;
  notes?: string | null;
  
  total_proposals: number;
  total_sales: number;
  total_value: number;
  total_comissao?: number;
  total_mwh?: number;
  total_kwp?: number;
  /** Units (cards/lines) across every sale of this client, any status. */
  total_cartoes?: number;
  /** Keys from organizations.client_document_types this client has handed in. */
  documents_checked?: string[];

  created_at: string;
  updated_at: string;
  
  // Relations
  lead?: Lead | null;
}

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  vip: 'VIP',
};

export const CLIENT_STATUS_STYLES: Record<ClientStatus, { bg: string; text: string; border: string }> = {
  active: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/20' },
  inactive: { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-muted' },
  vip: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/20' },
};

export const CLIENT_SOURCE_LABELS: Record<string, string> = {
  lead: 'Lead Convertido',
  referral: 'Indicação',
  direct: 'Contacto Direto',
  website: 'Website',
  other: 'Outro',
};

// Client Field Settings Types
export type ClientFieldKey = 'name' | 'email' | 'phone' | 'company' | 'company_nif' | 'nif' | 'address' | 'notes';

export interface ClientFieldConfig {
  visible: boolean;
  required: boolean;
  label: string;
}

export interface ClientFieldsSettings {
  name: ClientFieldConfig;
  email: ClientFieldConfig;
  phone: ClientFieldConfig;
  company: ClientFieldConfig;
  company_nif: ClientFieldConfig;
  nif: ClientFieldConfig;
  address: ClientFieldConfig;
  notes: ClientFieldConfig;
}

export const CLIENT_FIELD_DEFAULTS: Record<ClientFieldKey, { label: string; icon: string }> = {
  name: { label: 'Nome', icon: 'User' },
  email: { label: 'Email', icon: 'Mail' },
  phone: { label: 'Telefone', icon: 'Phone' },
  company: { label: 'Empresa', icon: 'Building' },
  company_nif: { label: 'Contribuinte (Empresa)', icon: 'FileText' },
  nif: { label: 'NIF', icon: 'FileText' },
  address: { label: 'Morada', icon: 'MapPin' },
  notes: { label: 'Notas', icon: 'MessageSquare' },
};

export const DEFAULT_CLIENT_FIELDS_SETTINGS: ClientFieldsSettings = {
  name: { visible: true, required: false, label: 'Nome' },
  email: { visible: true, required: false, label: 'Email' },
  phone: { visible: true, required: false, label: 'Telefone' },
  company: { visible: true, required: false, label: 'Empresa' },
  company_nif: { visible: true, required: false, label: 'Contribuinte (Empresa)' },
  nif: { visible: true, required: false, label: 'NIF' },
  address: { visible: true, required: false, label: 'Morada' },
  notes: { visible: true, required: false, label: 'Notas' },
};
