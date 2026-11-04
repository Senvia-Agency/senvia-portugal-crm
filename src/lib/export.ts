import * as XLSX from 'xlsx';
import { buildExportCsv } from './export-csv';
import { format as formatDate } from 'date-fns';
import { pt } from 'date-fns/locale';
import type { Lead } from '@/types';
import type { CrmClient } from '@/types/clients';
import { getProspectCom, getProspectSegment } from '@/lib/prospects/segment';
import type { Prospect } from '@/types/prospects';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, SALE_STATUS_LABELS, TELECOM_STATUS_LABELS, type SaleWithDetails } from '@/types/sales';
import { NEGOTIATION_TYPE_LABELS, PROPOSAL_STATUS_LABELS, PROPOSAL_TYPE_LABELS, type Proposal } from '@/types/proposals';

// Status labels for clients
const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  vip: 'Ativo',
  prospect: 'Prospeto',
};

// Helper to format date for export
function formatExportDate(dateString: string | null | undefined): string {
  if (!dateString) return '';
  try {
    return formatDate(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: pt });
  } catch {
    return '';
  }
}

// Map leads data for export
export function mapLeadsForExport(leads: Lead[]) {
  return leads.map(lead => ({
    'Nome': lead.name,
    'Email': lead.email,
    'Telefone': lead.phone,
    'Status': lead.status || '',
    'Temperatura': lead.temperature || '',
    'Fonte': lead.source || '',
    'Valor': lead.value || 0,
    'Data de Criação': formatExportDate(lead.created_at),
  }));
}

// Map clients data for export
export function mapClientsForExport(clients: CrmClient[], isTelecom = false) {
  return clients.map(client => {
    const base: Record<string, unknown> = {
      'Código': client.code || '',
      'Nome': client.name,
      'Email': client.email || '',
      'Telefone': client.phone || '',
      'Empresa': client.company || '',
      'NIF': client.nif || '',
      'Estado': CLIENT_STATUS_LABELS[client.status || ''] || client.status || '',
      'Total Propostas': client.total_proposals || 0,
      'Total Vendas': client.total_sales || 0,
    };

    if (isTelecom) {
      base['Comissão'] = client.total_comissao || 0;
      base['MWh'] = client.total_mwh || 0;
      base['kWp'] = client.total_kwp || 0;
    } else {
      base['Valor Total'] = client.total_value || 0;
    }

    base['Data de Criação'] = formatExportDate(client.created_at);
    return base;
  });
}

export function mapProspectsForExport(
  prospects: Prospect[],
  salespersonMap: Map<string, string>
) {
  return prospects.map((prospect) => ({
    'Empresa': prospect.company_name,
    'NIF': prospect.nif || '',
    'CPE': prospect.cpe || '',
    'Email': prospect.email || '',
    'Telefone': prospect.phone || '',
    'Segmento': getProspectSegment(prospect) || '',
    'COM': getProspectCom(prospect) || '',
    'kWh/Ano': prospect.annual_consumption_kwh || 0,
    'Comercial': prospect.assigned_to ? salespersonMap.get(prospect.assigned_to) || '—' : 'Não atribuído',
    'Estado': prospect.converted_to_lead ? 'Convertido' : 'Por distribuir',
    'Data de Importação': formatExportDate(prospect.imported_at),
  }));
}

interface Perfect2GetherProposalSnapshot {
  id: string;
  code?: string | null;
  accepted_at?: string | null;
  proposal_date?: string | null;
  proposal_type?: string | null;
  negotiation_type?: string | null;
  kwp?: number | null;
  margem?: number | null;
  dbl?: number | null;
  anos_contrato?: number | null;
  comissao?: number | null;
  total_value?: number | null;
}

interface Perfect2GetherProposalCpeSnapshot {
  proposal_id: string;
  serial_number?: string | null;
  consumo_anual?: number | null;
  duracao_contrato?: number | null;
  dbl?: number | null;
  margem?: number | null;
  comissao?: number | null;
  contrato_inicio?: string | null;
  contrato_fim?: string | null;
}

interface Perfect2GetherPaymentSnapshot {
  sale_id: string;
  amount: number;
  status: string;
}

interface Perfect2GetherSalesExportDeps {
  proposalsById: Map<string, Perfect2GetherProposalSnapshot>;
  cpesByProposalId: Map<string, Perfect2GetherProposalCpeSnapshot[]>;
  paymentsBySaleId: Map<string, Perfect2GetherPaymentSnapshot[]>;
  consultantsById: Map<string, string>;
  leadSourcesById: Map<string, string>;
}

function formatExportDay(dateString: string | null | undefined): string {
  if (!dateString) return '';
  try {
    return formatDate(new Date(dateString), 'dd/MM/yyyy', { locale: pt });
  } catch {
    return '';
  }
}

function formatExportMonth(dateString: string | null | undefined): string {
  if (!dateString) return '';
  try {
    const value = formatDate(new Date(dateString), 'MMMM yyyy', { locale: pt });
    return value.charAt(0).toUpperCase() + value.slice(1);
  } catch {
    return '';
  }
}

function formatExportQuarter(dateString: string | null | undefined): string {
  if (!dateString) return '';
  try {
    const quarter = Math.ceil((new Date(dateString).getMonth() + 1) / 3);
    return `${quarter}º Trimestre`;
  } catch {
    return '';
  }
}

function valueOrEmpty(value: unknown) {
  return value ?? '';
}

export function mapPerfect2GetherSalesForExport(
  sales: SaleWithDetails[],
  deps: Perfect2GetherSalesExportDeps
) {
  return sales.flatMap((sale) => {
    const proposalId = sale.proposal_id || sale.proposal?.id || null;
    const proposal = proposalId ? deps.proposalsById.get(proposalId) : undefined;
    const cpes = proposalId ? deps.cpesByProposalId.get(proposalId) || [] : [];
    const rows = cpes.length > 0 ? cpes : [undefined];
    const consultantId = sale.lead?.assigned_to || sale.created_by || '';
    const consultantName = consultantId ? deps.consultantsById.get(consultantId) || '—' : '—';
    const leadSource = sale.lead_id ? deps.leadSourcesById.get(sale.lead_id) || '' : '';
    const commissionValue = cpes.reduce((sum, cpe) => sum + Number(cpe.comissao || 0), 0)
      || Number(sale.comissao || proposal?.comissao || 0);
    const paidAmount = (deps.paymentsBySaleId.get(sale.id) || [])
      .filter((payment) => payment.status === 'paid')
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const paymentMethodLabel = sale.payment_method
      ? PAYMENT_METHOD_LABELS[sale.payment_method] || sale.payment_method
      : '';
    const typeLabel = proposal?.proposal_type
      ? PROPOSAL_TYPE_LABELS[proposal.proposal_type as keyof typeof PROPOSAL_TYPE_LABELS] || proposal.proposal_type
      : sale.proposal_type || '';
    const negotiationLabel = proposal?.negotiation_type
      ? NEGOTIATION_TYPE_LABELS[proposal.negotiation_type as keyof typeof NEGOTIATION_TYPE_LABELS] || proposal.negotiation_type
      : sale.negotiation_type || '';

    return rows.map((cpe) => ({
      'Mês': formatExportMonth(sale.activation_date),
      'Trimestre': formatExportQuarter(sale.activation_date),
      'Consultor': consultantName,
      'nome cliente': sale.client?.name || sale.lead?.name || '',
      'NIPC': sale.client?.nif || '',
      'Produção Total': '',
      'Valor da proposta': valueOrEmpty(sale.total_value || proposal?.total_value),
      'Modalidade Pagamento': paymentMethodLabel,
      'Data de Adjudicação': formatExportDay(sale.activation_date),
      'KWP': valueOrEmpty(sale.kwp ?? proposal?.kwp),
      'Margem Comercial': valueOrEmpty(sale.margem ?? proposal?.margem ?? cpe?.margem),
      'Canal de Angariação': leadSource,
      'COMISSÃO': valueOrEmpty(commissionValue),
      'A RECEBER': valueOrEmpty(Math.max(0, commissionValue)),
      'Tipo de registro de oportunidade * Tipo': [typeLabel, negotiationLabel].filter(Boolean).join(' · '),
      'Linha de Contrato: Local de Cons': cpe?.serial_number || '',
      'Consumo anual': valueOrEmpty(cpe?.consumo_anual ?? sale.consumo_anual),
      'Duração contrato (anos)': valueOrEmpty(cpe?.duracao_contrato ?? sale.anos_contrato ?? proposal?.anos_contrato),
      'Consumo contratado': valueOrEmpty(cpe?.consumo_anual ?? sale.consumo_anual),
      'Data de Início': formatExportDay(cpe?.contrato_inicio ?? sale.activation_date),
      'Data Fim de C': formatExportDay(cpe?.contrato_fim),
      'Data de Aceitação da Proposta': formatExportDay(proposal?.accepted_at),
      'Número de Proposta': sale.edp_proposal_number || proposal?.code || '',
      'Margem Unitária': valueOrEmpty(cpe?.margem ?? sale.margem ?? proposal?.margem),
      'TIR/WACC': valueOrEmpty(cpe?.dbl ?? sale.dbl ?? proposal?.dbl),
      'Margem Final': valueOrEmpty(sale.margem ?? proposal?.margem ?? cpe?.margem),
      'Margem Target': '',
      'Tarifa Final': '',
      'Tarifa Target': '',
      'Valor Recebido': valueOrEmpty(paidAmount),
    }));
  });
}

// Helper to download file
function downloadFile(content: string | ArrayBuffer, filename: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8;` });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

// Export to CSV
export function exportToCsv(data: Record<string, unknown>[], filename: string) {
  const csv = buildExportCsv(data);
  downloadFile(csv, `${filename}.csv`, 'text/csv');
}

// Export to Excel
export function exportToExcel(data: Record<string, unknown>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(data);
  
  // Auto-size columns based on content
  const colWidths = Object.keys(data[0] || {}).map(key => ({
    wch: Math.max(
      key.length,
      ...data.map(row => String(row[key] ?? '').length)
    ) + 2
  }));
  ws['!cols'] = colWidths;
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// Map proposals for export: the list as it is filtered on screen.
export function mapProposalsForExport(proposals: Proposal[], isTelecom = false) {
  return proposals.map((proposal) => {
    const row: Record<string, unknown> = {
      'Código': proposal.code || '',
      'Data': formatExportDay(proposal.proposal_date),
      'Cliente': proposal.client?.name || proposal.lead?.name || '',
      'Email': proposal.client?.email || proposal.lead?.email || '',
      'Telefone': proposal.client?.phone || proposal.lead?.phone || '',
      'Estado': PROPOSAL_STATUS_LABELS[proposal.status] || proposal.status,
      'Valor': Number(proposal.total_value || 0),
    };
    if (isTelecom) {
      row['Tipo'] = proposal.proposal_type ? PROPOSAL_TYPE_LABELS[proposal.proposal_type] || proposal.proposal_type : '';
      row['Negociação'] = proposal.negotiation_type
        ? NEGOTIATION_TYPE_LABELS[proposal.negotiation_type] || proposal.negotiation_type
        : '';
      row['Comissão'] = valueOrEmpty(proposal.comissao);
      row['kWp'] = valueOrEmpty(proposal.kwp);
    }
    row['Aceite em'] = formatExportDay(proposal.accepted_at);
    row['Notas'] = proposal.notes || '';
    return row;
  });
}

// Map sales for export: the list as it is filtered on screen.
export function mapSalesForExport(sales: SaleWithDetails[], isTelecom = false) {
  return sales.map((sale) => {
    const status = isTelecom && sale.telecom_status
      ? TELECOM_STATUS_LABELS[sale.telecom_status] || sale.telecom_status
      : SALE_STATUS_LABELS[sale.status] || sale.status;
    const row: Record<string, unknown> = {
      'Código': sale.code || '',
      'Data': formatExportDay(sale.sale_date),
      'Cliente': sale.client?.name || sale.lead?.name || '',
      'Empresa': sale.client?.company || '',
      'NIF': sale.client?.nif || '',
      'Email': sale.client?.email || sale.lead?.email || '',
      'Estado': status,
    };
    if (isTelecom) {
      row['Tipo'] = sale.proposal_type ? PROPOSAL_TYPE_LABELS[sale.proposal_type] || sale.proposal_type : '';
      row['Comissão'] = valueOrEmpty(sale.comissao);
      row['kWp'] = valueOrEmpty(sale.kwp);
      row['Consumo anual'] = valueOrEmpty(sale.consumo_anual);
      row['Data de ativação'] = formatExportDay(sale.activation_date);
    } else {
      row['Valor'] = Number(sale.total_value || 0);
      row['Pagamento'] = PAYMENT_STATUS_LABELS[sale.payment_status] || sale.payment_status || '';
      row['Método'] = sale.payment_method ? PAYMENT_METHOD_LABELS[sale.payment_method] || sale.payment_method : '';
      row['Fatura'] = sale.invoice_reference || '';
    }
    row['Notas'] = sale.notes || '';
    return row;
  });
}
