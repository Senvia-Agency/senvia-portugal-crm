import { NicheType } from './pipeline-templates';

export interface NicheLabels {
  singular: string;
  plural: string;
  since: string;
  new: string;
  total: string;
  active: string;
  inactive: string;
  moduleName: string;
  statusFieldLabel: string;
  statusActive: string;
  statusInactive: string;
}

export const NICHE_CLIENT_LABELS: Record<NicheType, NicheLabels> = {
  generic: {
    singular: 'Cliente',
    plural: 'Clientes',
    since: 'Cliente desde',
    new: 'Novo Cliente',
    total: 'Total Clientes',
    active: 'Clientes Ativos',
    inactive: 'Clientes Inativos',
    moduleName: 'Clientes',
    statusFieldLabel: 'Estado',
    statusActive: 'Ativo',
    statusInactive: 'Inativo',
  },
  clinic: {
    singular: 'Paciente',
    plural: 'Pacientes',
    since: 'Paciente desde',
    new: 'Novo Paciente',
    total: 'Total Pacientes',
    active: 'Pacientes Ativos',
    inactive: 'Pacientes Inativos',
    moduleName: 'Pacientes',
    statusFieldLabel: 'Estado',
    statusActive: 'Ativo',
    statusInactive: 'Inativo',
  },
  construction: {
    singular: 'Cliente',
    plural: 'Clientes',
    since: 'Cliente desde',
    new: 'Novo Cliente',
    total: 'Total Clientes',
    active: 'Clientes Ativos',
    inactive: 'Clientes Inativos',
    moduleName: 'Clientes',
    statusFieldLabel: 'Estado',
    statusActive: 'Ativo',
    statusInactive: 'Inativo',
  },
  telecom: {
    singular: 'Cliente',
    plural: 'Clientes',
    since: 'Cliente desde',
    new: 'Novo Cliente',
    total: 'Total Clientes',
    active: 'Clientes Bronze',
    inactive: 'Clientes Prata',
    moduleName: 'Clientes',
    statusFieldLabel: 'Tipologia',
    statusActive: 'Bronze',
    statusInactive: 'Prata',
  },
  ecommerce: {
    singular: 'Cliente',
    plural: 'Clientes',
    since: 'Cliente desde',
    new: 'Novo Cliente',
    total: 'Total Clientes',
    active: 'Clientes Ativos',
    inactive: 'Clientes Inativos',
    moduleName: 'Clientes',
    statusFieldLabel: 'Estado',
    statusActive: 'Ativo',
    statusInactive: 'Inativo',
  },
  real_estate: {
    singular: 'Cliente',
    plural: 'Clientes',
    since: 'Cliente desde',
    new: 'Novo Cliente',
    total: 'Total Clientes',
    active: 'Clientes Ativos',
    inactive: 'Clientes Inativos',
    moduleName: 'Clientes',
    statusFieldLabel: 'Estado',
    statusActive: 'Ativo',
    statusInactive: 'Inativo',
  },
};

export function getClientLabels(niche: NicheType | string | null | undefined): NicheLabels {
  const validNiche = niche as NicheType;
  return NICHE_CLIENT_LABELS[validNiche] || NICHE_CLIENT_LABELS.generic;
}
