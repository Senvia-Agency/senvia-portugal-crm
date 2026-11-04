import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Trash2, Printer, Mail, Loader2, Router, Zap, Wrench, Pencil, MoreHorizontal, TrendingUp, FileText, AlertTriangle, Package, MessageSquareText, UserRound, Info, Paperclip, Check, type LucideIcon } from 'lucide-react';
import { LeadAttachments } from '@/components/leads/LeadAttachments';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { initialsOf } from '@/components/leads/lead-display';
import { PROPOSAL_STATUS_PILLS, PROPOSAL_STATUS_SOLID } from './proposal-display';
import { PageModuleIcon } from '@/components/layout/ModuleNavIcon';
import { useSendProposalEmail } from '@/hooks/useSendProposalEmail';
import { EmailTemplateGate } from '@/components/marketing/EmailTemplateGate';
import { EMAIL_TEMPLATE_TRIGGERS } from '@/lib/email-template-triggers';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateProposal, useDeleteProposal, useProposalProducts } from '@/hooks/useProposals';
import { useProposalCpes } from '@/hooks/useProposalCpes';
import { useUpdateLeadStatus, useUpdateLead } from '@/hooks/useLeads';
import { useFinalStages } from '@/hooks/usePipelineStages';
import { useOrganization } from '@/hooks/useOrganization';
import { useModules } from '@/hooks/useModules';
import { useAuth } from '@/contexts/AuthContext';
import { useCommissionMatrix, getVolumeTier } from '@/hooks/useCommissionMatrix';
import { 
  PROPOSAL_STATUS_LABELS, 
  PROPOSAL_STATUSES, 
  PROPOSAL_TYPE_LABELS, 
  MODELO_SERVICO_LABELS,
  NEGOTIATION_TYPE_LABELS,
  FIELD_LABELS,
  type NegotiationType,
  type ServicosDetails,
} from '@/types/proposals';
import { useServicosProducts } from '@/hooks/useServicosProducts';
import type { Proposal, ProposalStatus, ProposalType } from '@/types/proposals';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateSaleModal } from "@/components/sales/CreateSaleModal";
import { EditProposalModal } from "@/components/proposals/EditProposalModal";
import { useLanguage, dateLocale, intlLocale } from "@/i18n";

/** One figure of the strip under the header, with a coloured edge so it reads at a glance. */
function Figure({ label, value, tone, edge = "border-l-primary" }: { label: string; value: string; tone?: string; edge?: string }) {
  return (
    <div className={cn("min-w-[8rem] flex-1 rounded-xl border border-l-4 border-border/70 bg-card px-3.5 py-2 shadow-sm", edge)}>
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("truncate text-base font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

/** A section of the record: a white card with a coloured icon and its title, on the grey page. */
function Panel({ icon: Icon, title, tone = "bg-primary/10 text-primary", action, children, flush = false }: {
  icon: LucideIcon; title: string; tone?: string; action?: React.ReactNode; children: React.ReactNode; flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <header className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone)} aria-hidden="true"><Icon className="h-4 w-4" /></span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
        {action}
      </header>
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

interface ProposalDetailsModalProps {
  proposal: Proposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProposalDetailsModal({ proposal, open, onOpenChange }: ProposalDetailsModalProps) {
  const { t } = useLanguage();
  const { data: proposalProducts = [], isSuccess: productsLoaded, isFetching: productsFetching, isError: productsError } = useProposalProducts(proposal?.id);
  const { data: proposalCpes = [] } = useProposalCpes(proposal?.id);
  const { data: orgData } = useOrganization();
  const { modules } = useModules();
  const isTelecom = orgData?.niche === 'telecom';
  const showEnergy = isTelecom && modules.energy;
  const { configs: SERVICOS_PRODUCT_CONFIGS } = useServicosProducts();
  const updateProposal = useUpdateProposal();
  const deleteProposal = useDeleteProposal();
  const updateLeadStatus = useUpdateLeadStatus();
  const updateLead = useUpdateLead();
  const { finalPositiveStage, finalNegativeStage } = useFinalStages();
  const sendProposalEmail = useSendProposalEmail();
  const { calculateEnergyCommission, hasEnergyConfig } = useCommissionMatrix();
  // Obter logo e nome da organização
  const logoUrl = (orgData?.form_settings as any)?.logo_url || null;
  const orgName = orgData?.name || '';
  
  const [status, setStatus] = useState<ProposalStatus>('draft');
  const [notes, setNotes] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Recalculate energy CPE commissions using current tier rules
  const recalculatedCpes = useMemo(() => {
    if (!hasEnergyConfig || proposalCpes.length === 0) return proposalCpes;
    return proposalCpes.map(cpe => {
      if (!cpe.margem || !cpe.consumo_anual) return cpe;
      const margem = Number(cpe.margem);
      if (margem <= 0) return cpe;
      const calc = calculateEnergyCommission(margem, getVolumeTier(Number(cpe.consumo_anual) || 0));
      if (calc === null) return cpe;
      return { ...cpe, comissao: calc };
    });
  }, [proposalCpes, hasEnergyConfig, calculateEnergyCommission]);


  const { data: completedSale } = useQuery({
    queryKey: ['proposal-completed-sale', proposal?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('sales')
        .select('id, status')
        .eq('proposal_id', proposal!.id)
        .eq('status', 'delivered')
        .maybeSingle();
      return data;
    },
    enabled: !!proposal?.id,
  });

  const hasCompletedSale = !!completedSale;
  const canOutputProposal = isTelecom || (productsLoaded && !productsFetching && !productsError && proposalProducts.length > 0);
  const missingLineItems = !isTelecom && productsLoaded && !productsFetching && !productsError
    && proposalProducts.length === 0 && Number(proposal?.total_value) > 0;

  // Sincronizar estado quando proposal muda
  useEffect(() => {
    if (proposal) {
      setStatus(proposal.status);
      setNotes(proposal.notes || '');
    }
  }, [proposal]);

  const navigate = useNavigate();
  // Before the early return below: hooks must run in the same order on every render.
  const { organization } = useAuth();

  // Early return if no proposal
  if (!proposal) {
    return null;
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
  };

  const handleStatusChange = (newStatus: ProposalStatus) => {
    if (newStatus === 'accepted') {
      if (!canOutputProposal) return;
      setShowSaleModal(true);
      return;
    }
    
    setStatus(newStatus);
    updateProposal.mutate({ id: proposal.id, status: newStatus });
    
    if (newStatus === 'rejected') {
      if (proposal.lead_id && finalNegativeStage) {
        updateLeadStatus.mutate({ leadId: proposal.lead_id, status: finalNegativeStage.key });
      }
    }
  };

  const handleSaleCreated = () => {
    updateProposal.mutate({ id: proposal.id, status: 'accepted' });

    if (proposal.lead_id && finalPositiveStage) {
      updateLeadStatus.mutate({ leadId: proposal.lead_id, status: finalPositiveStage.key });
      updateLead.mutate({ leadId: proposal.lead_id, updates: { value: proposal.total_value } });
    }

    setShowSaleModal(false);
    onOpenChange(false);
    navigate('/sales');
  };

  const handleNotesBlur = () => {
    if (notes !== proposal.notes) {
      updateProposal.mutate({ id: proposal.id, notes: notes.trim() || undefined });
    }
  };

  const handlePrint = () => {
    if (!canOutputProposal) return;
    const client = proposal.client;
    const clientName = client?.name || '';
    const clientEmail = client?.email || '';
    const clientPhone = client?.phone || '';
    const clientCompany = (client as any)?.company || '';
    const clientNif = (client as any)?.nif || '';
    const clientAddress = (client as any)?.address_line1 || '';
    const clientCity = (client as any)?.city || '';
    const clientPostalCode = (client as any)?.postal_code || '';
    const fullAddress = [clientAddress, clientPostalCode, clientCity].filter(Boolean).join(', ');

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Proposta ${proposal.code || ''}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif; 
              padding: 40px; 
              color: #1a1a1a; 
              max-width: 800px; 
              margin: 0 auto; 
              line-height: 1.6;
              background: white;
            }
            .header { 
              display: flex; 
              justify-content: space-between; 
              align-items: flex-start;
              border-bottom: 3px solid #3B82F6;
              padding-bottom: 25px;
              margin-bottom: 30px;
            }
            .header-left { display: flex; flex-direction: column; gap: 8px; }
            .header-left img { max-height: 60px; max-width: 180px; object-fit: contain; }
            .header-left .org-name { font-size: 14px; color: #64748b; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
            .header-right { text-align: right; }
            .header-right h1 { font-size: 22px; color: #3B82F6; font-weight: 700; margin-bottom: 4px; }
            .header-right .date { color: #64748b; font-size: 14px; }
            .client-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 25px; }
            .client-box h3 { margin: 0 0 12px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
            .client-box .client-name { font-size: 18px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px; }
            .client-box .client-details { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; }
            .client-box .client-detail { font-size: 13px; color: #475569; }
            .client-box .client-detail strong { color: #64748b; font-weight: 500; }
            .total-box { background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); color: white; padding: 28px; border-radius: 12px; text-align: center; margin: 25px 0; box-shadow: 0 4px 20px rgba(59, 130, 246, 0.3); }
            .total-box .label { font-size: 11px; opacity: 0.9; letter-spacing: 2px; text-transform: uppercase; font-weight: 500; }
            .total-box .value { font-size: 42px; font-weight: 700; margin-top: 8px; letter-spacing: -1px; }
            .cpes { margin: 30px 0; }
            .cpes h3 { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 12px; }
            .cpe-card { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
            .cpe-header { font-weight: 600; margin-bottom: 8px; color: #92400e; }
            .cpe-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 13px; }
            .cpe-field { color: #78350f; }
            .cpe-field strong { color: #92400e; }
            .notes-section { background: #fefce8; border-left: 4px solid #eab308; padding: 16px 20px; border-radius: 0 10px 10px 0; margin: 25px 0; }
            .notes-section h4 { font-size: 11px; color: #a16207; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 8px; }
            .notes-section p { font-size: 14px; color: #713f12; white-space: pre-wrap; line-height: 1.5; }
            .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 11px; }
            .footer p { margin: 4px 0; }
            .footer .validity { color: #64748b; font-weight: 500; }
            @media print { body { padding: 20px; } .total-box { box-shadow: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-left">
              ${logoUrl ? `<img src="${logoUrl}" alt="Logo" />` : ''}
              ${orgName ? `<span class="org-name">${orgName}</span>` : ''}
            </div>
            <div class="header-right">
              <h1>PROPOSTA ${proposal.code || ''}</h1>
              <div class="date">${format(new Date(proposal.proposal_date), "d 'de' MMMM 'de' yyyy", { locale: pt })}</div>
            </div>
          </div>
          
          ${clientName ? `
          <div class="client-box">
            <h3>Cliente</h3>
            <div class="client-name">${clientName}</div>
            <div class="client-details">
              ${clientCompany ? `<div class="client-detail"><strong>Empresa:</strong> ${clientCompany}</div>` : ''}
              ${clientNif ? `<div class="client-detail"><strong>NIF:</strong> ${clientNif}</div>` : ''}
              ${clientEmail ? `<div class="client-detail"><strong>Email:</strong> ${clientEmail}</div>` : ''}
              ${clientPhone ? `<div class="client-detail"><strong>Telefone:</strong> ${clientPhone}</div>` : ''}
              ${fullAddress ? `<div class="client-detail" style="grid-column: span 2;"><strong>Morada:</strong> ${fullAddress}</div>` : ''}
            </div>
          </div>
          ` : ''}
          
           <div class="total-box">
            <div class="label">${showEnergy ? 'Consumo Total MWh' : 'Valor Total'}</div>
            <div class="value">${showEnergy 
              ? `${(recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.consumo_anual) || 0), 0) / 1000).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} MWh`
              : formatCurrency(proposal.total_value)}</div>
            ${showEnergy && proposal.proposal_type === 'energia' && recalculatedCpes.length > 0 ? `
              <div style="font-size: 12px; color: #666; margin-top: 6px;">
                Margem Total: <strong>${formatCurrency(recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.margem) || 0), 0))}</strong>
                &nbsp;|&nbsp;
                Comissão Total: <strong>${formatCurrency(recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.comissao) || 0), 0))}</strong>
              </div>
            ` : ''}
            ${isTelecom && proposal.proposal_type === 'servicos' ? `
              <div style="font-size: 12px; color: #666; margin-top: 6px;">
                ${proposal.kwp != null ? `kWp: <strong>${Number(proposal.kwp).toLocaleString('pt-PT')}</strong>` : ''}
                ${proposal.kwp != null && proposal.comissao != null ? '&nbsp;|&nbsp;' : ''}
                ${proposal.comissao != null ? `Comissão: <strong>${formatCurrency(Number(proposal.comissao))}</strong>` : ''}
              </div>
            ` : ''}
          </div>

          ${showEnergy && recalculatedCpes.length > 0 ? `
            <div class="cpes">
              <h3>CPEs / Pontos de Consumo</h3>
              ${recalculatedCpes.map(cpe => `
                <div class="cpe-card">
                  <div class="cpe-header">${cpe.equipment_type} ${cpe.serial_number ? `- ${cpe.serial_number}` : ''}</div>
                  <div class="cpe-grid">
                    <div class="cpe-field"><strong>Comercializador:</strong> ${cpe.comercializador}</div>
                    ${cpe.consumo_anual ? `<div class="cpe-field"><strong>Consumo:</strong> ${Number(cpe.consumo_anual).toLocaleString('pt-PT')} kWh</div>` : ''}
                    ${cpe.duracao_contrato ? `<div class="cpe-field"><strong>Duração:</strong> ${cpe.duracao_contrato} anos</div>` : ''}
                    ${cpe.dbl ? `<div class="cpe-field"><strong>DBL:</strong> ${cpe.dbl} €/MWh</div>` : ''}
                    ${cpe.margem ? `<div class="cpe-field"><strong>Margem:</strong> ${formatCurrency(Number(cpe.margem))}</div>` : ''}
                    ${cpe.comissao ? `<div class="cpe-field"><strong>Comissão:</strong> ${formatCurrency(Number(cpe.comissao))}</div>` : ''}
                    ${cpe.contrato_inicio ? `<div class="cpe-field"><strong>Início:</strong> ${cpe.contrato_inicio}</div>` : ''}
                    ${cpe.contrato_fim ? `<div class="cpe-field"><strong>Fim:</strong> ${cpe.contrato_fim}</div>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${!showEnergy && proposalProducts.length > 0 ? `
            <div class="cpes">
              <h3>Produtos / Serviços</h3>
              <table style="width:100%; border-collapse:collapse;">
                <thead>
                  <tr style="border-bottom:2px solid #eee;">
                    <th style="text-align:left; padding:8px;">Produto</th>
                    <th style="text-align:center; padding:8px;">Qtd</th>
                    <th style="text-align:right; padding:8px;">Preço Unit.</th>
                    <th style="text-align:right; padding:8px;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${proposalProducts.map(item => `
                    <tr style="border-bottom:1px solid #f0f0f0;">
                      <td style="padding:8px;">${item.product?.name || 'Produto'}</td>
                      <td style="text-align:center; padding:8px;">${item.quantity}</td>
                      <td style="text-align:right; padding:8px;">${formatCurrency(item.unit_price)}</td>
                      <td style="text-align:right; padding:8px;">${formatCurrency(item.total)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}

          ${notes ? `
            <div class="notes-section">
              <h4>Observações</h4>
              <p>${notes}</p>
            </div>
          ` : ''}

          <div class="footer">
            <p class="validity">Proposta válida por 30 dias a partir da data de emissão</p>
            <p>Documento gerado em ${format(new Date(), "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: pt })}</p>
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.document.title = "Senvia OS";
      printWindow.print();
    }
  };

  const handleDelete = () => {
    deleteProposal.mutate(proposal.id, {
      onSuccess: () => {
        setShowDeleteConfirm(false);
        onOpenChange(false);
      },
    });
  };

  const handleSendEmail = () => {
    if (!canOutputProposal || !proposal.client?.email || !organization?.id) return;
    
    sendProposalEmail.mutate({
      organizationId: organization.id,
      to: proposal.client.email,
      clientName: proposal.client.name || 'Cliente',
      proposalCode: proposal.code || '',
      proposalDate: format(new Date(proposal.proposal_date), "d 'de' MMMM 'de' yyyy", { locale: pt }),
      totalValue: proposal.total_value,
      products: proposalProducts.map(item => ({
        name: item.product?.name || 'Produto',
        quantity: item.quantity,
        unitPrice: item.unit_price,
        total: item.total,
      })),
      notes: notes || undefined,
      orgName: orgName,
      logoUrl: logoUrl || undefined,
    });
  };

  const isBrevoConfigured = !!(orgData?.tem_brevo_api_key && orgData?.brevo_sender_email);
  const canSendEmail = canOutputProposal && proposal.client?.email && isBrevoConfigured && !sendProposalEmail.isPending;

  const who = proposal.client?.name || proposal.lead?.name || t('Proposta avulsa');
  const contact = proposal.client ?? proposal.lead ?? null;
  const totalMwh = recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.consumo_anual) || 0), 0) / 1000;
  const totalMargin = recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.margem) || 0), 0);
  const totalCommission = recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.comissao) || 0), 0);
  const dateLabel = format(new Date(proposal.proposal_date), "d MMM yyyy", { locale: dateLocale() });

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen && showSaleModal) return;
        onOpenChange(isOpen);
      }}>
        <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("Proposta")} {proposal.code || ''}</DialogTitle>
            <DialogDescription>{t("Estado, produtos, valores e cliente da proposta")}</DialogDescription>
          </DialogHeader>

          {/* Header: which proposal, for whom, what to do with it, and where it stands. */}
          <header className="shrink-0 border-b bg-background px-4 pb-3 pt-3 sm:px-6">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-3">
              <Button variant="back" size="icon" onClick={() => onOpenChange(false)} className="h-9 w-9 shrink-0 rounded-full" aria-label={t("Voltar")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <PageModuleIcon to="/proposals" />
              <div className="min-w-0 flex-1 basis-48">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-xl font-semibold tracking-tight">{t("Proposta")} {proposal.code ? `#${proposal.code}` : ''}</h2>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', PROPOSAL_STATUS_PILLS[status])}>{t(PROPOSAL_STATUS_LABELS[status])}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{who} · {dateLabel}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={handlePrint} disabled={!canOutputProposal}>
                  <Printer className="h-4 w-4" />{t("Imprimir")}
                </Button>
                <EmailTemplateGate triggerType={EMAIL_TEMPLATE_TRIGGERS.proposal}>
                  <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={handleSendEmail} disabled={!canSendEmail}>
                    {sendProposalEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    {!isBrevoConfigured ? t("Configurar email") : t("Enviar email")}
                  </Button>
                </EmailTemplateGate>
                <Button size="sm" className="h-9 rounded-full" onClick={() => setShowEditModal(true)} disabled={hasCompletedSale}>
                  <Pencil className="h-4 w-4" />{t("Editar")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label={t("Mais ações da proposta")}><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setShowDeleteConfirm(true)}>
                      <Trash2 className="mr-2 h-4 w-4" />{t("Eliminar proposta")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* The proposal's state, one click to change. "Aceite" opens the sale. */}
            <div className="mx-auto mt-3 w-full max-w-6xl">
              <div className="flex gap-1 overflow-x-auto rounded-full border border-border bg-muted p-1" role="group" aria-label={t("Estado da proposta")}>
                {PROPOSAL_STATUSES.map((s) => {
                  const current = s === status;
                  const blocked = hasCompletedSale || (s === 'accepted' && !canOutputProposal);
                  return (
                    <button key={s} type="button" disabled={current || blocked} aria-current={current ? 'step' : undefined}
                      title={current ? t("Estado atual") : s === 'accepted' ? t("Marcar como aceite e criar a venda") : t("Marcar como {{status}}", { status: t(PROPOSAL_STATUS_LABELS[s]).toLowerCase() })}
                      onClick={() => handleStatusChange(s)}
                      className={cn('flex min-w-[6.5rem] flex-1 items-center justify-center gap-1.5 truncate rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default',
                        current ? cn(PROPOSAL_STATUS_SOLID[s], 'shadow-sm')
                          : blocked ? 'text-muted-foreground disabled:cursor-not-allowed'
                          : 'bg-card text-foreground shadow-sm hover:bg-accent')}>
                      {current ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        : <span className={cn('h-2 w-2 shrink-0 rounded-full', PROPOSAL_STATUS_SOLID[s], blocked && 'opacity-40')} aria-hidden="true" />}
                      {t(PROPOSAL_STATUS_LABELS[s])}
                    </button>
                  );
                })}
              </div>
              {hasCompletedSale && <p className="mt-1.5 text-xs text-muted-foreground">{t("Esta proposta já tem uma venda concluída: o estado e o conteúdo ficam fixos.")}</p>}
            </div>

            {/* The proposal's numbers, always in view. */}
            <div className="mx-auto mt-3 flex w-full max-w-6xl flex-wrap gap-2">
              {showEnergy ? (
                <Figure label={t("Consumo total")} value={`${totalMwh.toLocaleString(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 2 })} MWh`} tone="text-primary" edge="border-l-amber-500" />
              ) : (
                <Figure label={t("Valor total")} value={formatCurrency(proposal.total_value)} tone="text-primary" edge="border-l-primary" />
              )}
              {showEnergy && proposal.proposal_type === 'energia' && recalculatedCpes.length > 0 && <>
                <Figure label={t("Margem total")} value={formatCurrency(totalMargin)} tone="text-emerald-600 dark:text-emerald-400" edge="border-l-emerald-500" />
                <Figure label={t("Comissão total")} value={formatCurrency(totalCommission)} edge="border-l-violet-500" />
              </>}
              {showEnergy && proposal.proposal_type === 'servicos' && <>
                {proposal.kwp != null && <Figure label={t("kWp")} value={Number(proposal.kwp).toLocaleString(intlLocale())} />}
                {proposal.comissao != null && <Figure label={t("Comissão")} value={formatCurrency(Number(proposal.comissao))} />}
              </>}
              {!showEnergy && proposalProducts.length > 0 && <Figure label={t("Produtos")} value={String(proposalProducts.length)} edge="border-l-violet-500" />}
              <Figure label={t("Data")} value={dateLabel} edge="border-l-slate-400" />
            </div>
          </header>

          {/* The record on a grey page: every section a white card with its own colour. */}
          <div className="flex-1 overflow-y-auto bg-muted/40">
            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">

              {/* What is being proposed. */}
              <div className="min-w-0 space-y-5">
                {(proposalProducts.length > 0 || !isTelecom) && (
                  <Panel icon={Package} title={t("Produtos e serviços")} tone="bg-violet-500/10 text-violet-600 dark:text-violet-300" flush
                    action={proposalProducts.length > 0 ? <span className="text-xs text-muted-foreground">{proposalProducts.length} {proposalProducts.length === 1 ? 'item' : 'itens'}</span> : undefined}>
                    {productsFetching && !productsLoaded && <p className="p-4 text-sm text-muted-foreground">{t("A carregar produtos...")}</p>}
                    {productsError && <p className="p-4 text-sm text-destructive">{t("Não foi possível carregar os produtos. Volta a abrir a proposta.")}</p>}
                    {missingLineItems && (
                      <div className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {t("Detalhe dos produtos em falta")}</p>
                        <p className="mt-1">{t("Esta proposta tem um valor guardado, mas não tem produto, quantidade ou preço unitário registados. Adiciona os produtos em Editar antes de imprimir, enviar ou aceitar.")}</p>
                      </div>
                    )}
                    {!productsFetching && productsLoaded && proposalProducts.length === 0 && !missingLineItems && (
                      <p className="p-4 text-sm text-muted-foreground">{t("Ainda não há produtos associados a esta proposta.")}</p>
                    )}
                    {proposalProducts.length > 0 && (
                      <div className="divide-y divide-border/60">
                        {proposalProducts.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true"><Package className="h-4 w-4" /></span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{item.product?.name || t("Produto")}</p>
                                <p className="text-xs text-muted-foreground">{item.quantity} × {formatCurrency(item.unit_price)}</p>
                              </div>
                            </div>
                            <p className="shrink-0 font-semibold tabular-nums">{formatCurrency(item.total)}</p>
                          </div>
                        ))}
                        <div className="flex items-center justify-between gap-3 bg-primary/5 px-4 py-3">
                          <p className="text-sm font-semibold">{t("Total")}</p>
                          <p className="text-lg font-bold tabular-nums text-primary">{formatCurrency(proposal.total_value)}</p>
                        </div>
                      </div>
                    )}
                  </Panel>
                )}

                {/* CPEs - Telecom only */}
                {showEnergy && recalculatedCpes.length > 0 && (
                  <Panel icon={Router} title={t("CPEs / pontos de consumo")} tone="bg-amber-500/15 text-amber-600 dark:text-amber-300">
                    <div className="space-y-3">
                      {recalculatedCpes.map((cpe) => (
                        <div key={cpe.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-800 dark:bg-amber-950/20">
                          <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />{cpe.equipment_type}</p>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                            <div><dt className="text-xs text-muted-foreground">{t("Comercializador")}</dt><dd className="font-medium">{cpe.comercializador}</dd></div>
                            {cpe.serial_number && <div><dt className="text-xs text-muted-foreground">{t("CPE/CUI")}</dt><dd className="font-mono text-xs font-medium">{cpe.serial_number}</dd></div>}
                            {cpe.consumo_anual && <div><dt className="text-xs text-muted-foreground">{t("Consumo anual")}</dt><dd className="font-medium">{Number(cpe.consumo_anual).toLocaleString(intlLocale())} {t("kWh")}</dd></div>}
                            {cpe.duracao_contrato && <div><dt className="text-xs text-muted-foreground">{t("Duração")}</dt><dd className="font-medium">{cpe.duracao_contrato} {cpe.duracao_contrato === 1 ? 'ano' : 'anos'}</dd></div>}
                            {cpe.dbl && <div><dt className="text-xs text-muted-foreground">{t("DBL")}</dt><dd className="font-medium">{cpe.dbl} {t("€/MWh")}</dd></div>}
                            {cpe.margem && <div><dt className="flex items-center gap-1 text-xs text-muted-foreground"><TrendingUp className="h-3 w-3" />{t("Margem")}</dt><dd className="font-medium text-green-600 dark:text-green-400">{formatCurrency(Number(cpe.margem))}</dd></div>}
                            {cpe.comissao && <div><dt className="text-xs text-muted-foreground">{t("Comissão")}</dt><dd className="font-medium text-primary">{formatCurrency(Number(cpe.comissao))}</dd></div>}
                            {cpe.contrato_inicio && <div><dt className="text-xs text-muted-foreground">{t("Início")}</dt><dd className="text-xs font-medium">{cpe.contrato_inicio}</dd></div>}
                            {cpe.contrato_fim && <div><dt className="text-xs text-muted-foreground">{t("Fim")}</dt><dd className="text-xs font-medium">{cpe.contrato_fim}</dd></div>}
                          </dl>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}

                {/* Serviços telecom */}
                {isTelecom && proposal.proposal_type === 'servicos' && (
                  <Panel icon={Wrench} title={t("Outros serviços")} tone="bg-violet-500/10 text-violet-600 dark:text-violet-300">
                    <div className="space-y-3">
                      {proposal.modelo_servico && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">{t("Modelo:")}</span>
                          <Badge variant="outline" className="ml-2">{t(MODELO_SERVICO_LABELS[proposal.modelo_servico as keyof typeof MODELO_SERVICO_LABELS]) || proposal.modelo_servico}</Badge>
                        </p>
                      )}
                      {proposal.servicos_produtos && proposal.servicos_produtos.length > 0 && (() => {
                        const details: ServicosDetails = (proposal as any).servicos_details || {};
                        return (
                          <div className="space-y-1.5">
                            {proposal.servicos_produtos.map((prod) => {
                              const d = details[prod];
                              const config = SERVICOS_PRODUCT_CONFIGS.find(c => c.name === prod);
                              return (
                                <div key={prod} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-muted/40 p-2.5 text-sm">
                                  <span className="min-w-[140px] font-medium">{prod}</span>
                                  {d && config?.fields.map(field => (
                                    d[field] != null && (
                                      <span key={field} className="text-muted-foreground">
                                        {t(FIELD_LABELS[field])}: <span className="font-medium text-foreground">{Number(d[field]).toLocaleString(intlLocale(), { maximumFractionDigits: 2 })}</span>
                                      </span>
                                    )
                                  ))}
                                  {!d && <span className="text-xs text-muted-foreground">{t("(sem detalhes)")}</span>}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {(proposal.kwp != null || proposal.comissao != null) && (
                        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-2 text-sm">
                          {proposal.kwp != null && <span><span className="text-muted-foreground">{t("kWp total:")}</span> <span className="font-medium">{Number(proposal.kwp).toLocaleString(intlLocale(), { maximumFractionDigits: 2 })}</span></span>}
                          {proposal.comissao != null && <span><span className="text-muted-foreground">{t("Comissão:")}</span> <span className="font-medium text-primary">{formatCurrency(proposal.comissao)}</span></span>}
                        </div>
                      )}
                    </div>
                  </Panel>
                )}

                <Panel icon={MessageSquareText} title={t("Observações da negociação")} tone="bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <Textarea
                    id="proposal-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={handleNotesBlur}
                    placeholder={t("Notas internas sobre a negociação...")}
                    rows={4}
                    className="rounded-xl bg-muted/30"
                  />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{t("Só a equipa vê estas notas. Guardam-se ao sair do campo.")}</p>
                </Panel>

                {/* Faturas anexadas da lead - Telecom only */}
                {isTelecom && proposal.lead_id && (
                  <Panel icon={Paperclip} title={t("Faturas da lead")} tone="bg-slate-500/10 text-slate-600 dark:text-slate-300">
                    <LeadAttachments leadId={proposal.lead_id} readOnly />
                  </Panel>
                )}
              </div>

              {/* For whom, and the proposal's details. */}
              <aside className="min-w-0">
                <div className="space-y-5 lg:sticky lg:top-0">
                  {contact && (
                    <Panel icon={UserRound} title={proposal.client ? t("Cliente") : t("Lead")} tone="bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                      <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-sm font-semibold text-indigo-700 dark:text-indigo-300" aria-hidden="true">{initialsOf(who)}</span>
                        <div className="min-w-0 text-sm">
                          <p className="truncate font-semibold">{who}</p>
                          {contact.email && <a href={`mailto:${contact.email}`} className="block truncate text-primary hover:underline">{contact.email}</a>}
                          {contact.phone && <a href={`tel:${contact.phone}`} className="block text-muted-foreground hover:text-foreground">{contact.phone}</a>}
                        </div>
                      </div>
                    </Panel>
                  )}
                  <Panel icon={Info} title={t("Detalhes")} tone="bg-amber-500/15 text-amber-600 dark:text-amber-300" flush>
                    <div className="divide-y divide-border/60 text-sm">
                      {proposal.code && <div className="flex justify-between gap-3 px-4 py-2.5"><span className="text-muted-foreground">{t("Número")}</span><span className="font-mono font-medium">#{proposal.code}</span></div>}
                      <div className="flex justify-between gap-3 px-4 py-2.5"><span className="text-muted-foreground">{t("Data")}</span><span className="font-medium">{dateLabel}</span></div>
                      <div className="flex items-center justify-between gap-3 px-4 py-2.5"><span className="text-muted-foreground">{t("Estado")}</span><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PROPOSAL_STATUS_PILLS[status])}>{t(PROPOSAL_STATUS_LABELS[status])}</span></div>
                      {showEnergy && proposal.proposal_type && (
                        <div className="flex justify-between gap-3 px-4 py-2.5"><span className="text-muted-foreground">{t("Tipo")}</span>
                          <span className="flex items-center gap-1 font-medium">{proposal.proposal_type === 'energia' ? <Zap className="h-3.5 w-3.5 text-amber-500" /> : <Wrench className="h-3.5 w-3.5 text-violet-500" />}{t(PROPOSAL_TYPE_LABELS[proposal.proposal_type as ProposalType]) || proposal.proposal_type}</span>
                        </div>
                      )}
                      {isTelecom && proposal.negotiation_type && (
                        <div className="flex justify-between gap-3 px-4 py-2.5"><span className="text-muted-foreground">{t("Negociação")}</span><span className="font-medium">{t(NEGOTIATION_TYPE_LABELS[proposal.negotiation_type as NegotiationType])}</span></div>
                      )}
                      <div className="flex justify-between gap-3 px-4 py-2.5"><span className="text-muted-foreground">{t("Validade")}</span><span className="font-medium">{t("30 dias")}</span></div>
                    </div>
                  </Panel>
                </div>
              </aside>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Eliminar proposta?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tem a certeza que pretende eliminar esta proposta? Esta ação não pode ser revertida.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("Eliminar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateSaleModal
        open={showSaleModal}
        onOpenChange={setShowSaleModal}
        prefillProposal={proposal}
        prefillClientId={proposal.client_id}
        prefillClient={proposal.client ? {
          id: proposal.client.id,
          name: proposal.client.name,
          email: proposal.client.email,
        } : null}
        onSaleCreated={handleSaleCreated}
      />

      <EditProposalModal
        proposal={proposal}
        open={showEditModal}
        onOpenChange={setShowEditModal}
        onSuccess={() => {
          onOpenChange(false);
        }}
      />
    </>
  );
}
