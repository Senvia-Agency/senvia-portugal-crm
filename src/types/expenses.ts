export interface ExpenseCategory {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  organization_id: string;
  category_id: string | null;
  description: string;
  amount: number;
  expense_date: string;
  is_recurring: boolean;
  notes: string | null;
  receipt_file_url: string | null;
  stripe_invoice_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  category?: ExpenseCategory;
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Instalações', description: 'Renda, água, eletricidade, internet', color: '#3b82f6' },
  { name: 'Marketing', description: 'Publicidade, anúncios, eventos', color: '#f59e0b' },
  { name: 'Software', description: 'Licenças, subscrições, ferramentas', color: '#8b5cf6' },
  { name: 'Pessoal', description: 'Salários, formação, benefícios', color: '#10b981' },
  { name: 'Operacional', description: 'Material, combustível, manutenção', color: '#ef4444' },
];
