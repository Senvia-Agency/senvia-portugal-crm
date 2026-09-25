import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Trash2, Printer, Mail, Loader2, Router, Zap, Wrench, Pencil, MoreHorizontal, CalendarDays, TrendingUp, FileText, User, AlertTriangle } from 'lucide-react';
import { LeadAttachments } from '@/components/leads/LeadAttachments';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSendProposalEmail } from '@/hooks/useSendProposalEmail';
import { EmailTemplateGate } from '@/components/marketing/EmailTemplateGate';
import { EMAIL_TEMPLATE_TRIGGERS } from '@/lib/email-template-triggers';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  PROPOSAL_STATUS_COLORS, 
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

interface ProposalDetailsModalProps {
  proposal: Proposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProposalDetailsModal({ proposal, open, onOpenChange }: ProposalDetailsModalProps) {
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

  const { organization } = useAuth();

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

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen && showSaleModal) return;
        onOpenChange(isOpen);
      }}>
        <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pr-14 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Proposta {proposal.code || ''}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto p-4 sm:p-6">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* LEFT COLUMN (60%) */}
                <div className="lg:col-span-3 space-y-4">
                  {/* Dados da Proposta - Context Card */}
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="font-mono text-sm font-semibold text-primary">
                          Proposta {proposal.code || ''}
                        </span>
                        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {format(new Date(proposal.proposal_date), "d MMM yyyy", { locale: pt })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Select 
                          value={status} 
                          onValueChange={(v) => handleStatusChange(v as ProposalStatus)}
                          disabled={hasCompletedSale}
                        >
                          <SelectTrigger className={cn('w-auto min-w-[140px] h-8 text-xs', PROPOSAL_STATUS_COLORS[status])}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PROPOSAL_STATUSES.map((s) => (
                              <SelectItem key={s} value={s} disabled={s === 'accepted' && !canOutputProposal}>
                                <span className={cn('px-2 py-0.5 rounded text-xs font-medium', PROPOSAL_STATUS_COLORS[s])}>
                                  {PROPOSAL_STATUS_LABELS[s]}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isTelecom && proposal.negotiation_type && (
                          <Badge variant="outline" className="text-xs">
                            {NEGOTIATION_TYPE_LABELS[proposal.negotiation_type as NegotiationType]}
                          </Badge>
                        )}
                        {showEnergy && proposal.proposal_type && (
                          <Badge variant="outline" className={cn(
                            "flex items-center gap-1 text-xs",
                            proposal.proposal_type === 'energia' 
                              ? "border-amber-500/50 text-amber-600 dark:text-amber-400" 
                              : "border-blue-500/50 text-blue-600 dark:text-blue-400"
                          )}>
                            {proposal.proposal_type === 'energia' ? <Zap className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                            {PROPOSAL_TYPE_LABELS[proposal.proposal_type as ProposalType] || proposal.proposal_type}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Cliente */}
                  {(proposal.client || proposal.lead) && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <User className="h-4 w-4" />
                          {proposal.client ? 'Cliente' : 'Lead'}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="space-y-1">
                          <p className="font-medium text-base">{proposal.client?.name || proposal.lead?.name}</p>
                          {(proposal.client?.email || proposal.lead?.email) && (
                            <p className="text-sm text-muted-foreground">{proposal.client?.email || proposal.lead?.email}</p>
                          )}
                          {(proposal.client?.phone || proposal.lead?.phone) && (
                            <p className="text-sm text-muted-foreground">{proposal.client?.phone || proposal.lead?.phone}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}


                  {/* CPEs - Telecom only */}
                  {showEnergy && recalculatedCpes.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Router className="h-4 w-4" />
                          CPEs / Pontos de Consumo
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        {recalculatedCpes.map((cpe) => (
                          <div
                            key={cpe.id}
                            className="p-4 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <span className="font-medium text-sm">{cpe.equipment_type}</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                              <div>
                                <span className="text-muted-foreground text-xs">Comercializador:</span>
                                <p className="font-medium">{cpe.comercializador}</p>
                              </div>
                              {cpe.serial_number && (
                                <div>
                                  <span className="text-muted-foreground text-xs">CPE/CUI:</span>
                                  <p className="font-medium font-mono text-xs">{cpe.serial_number}</p>
                                </div>
                              )}
                              {cpe.consumo_anual && (
                                <div>
                                  <span className="text-muted-foreground text-xs">Consumo Anual:</span>
                                  <p className="font-medium">{Number(cpe.consumo_anual).toLocaleString('pt-PT')} kWh</p>
                                </div>
                              )}
                              {cpe.duracao_contrato && (
                                <div>
                                  <span className="text-muted-foreground text-xs">Duração:</span>
                                  <p className="font-medium">{cpe.duracao_contrato} {cpe.duracao_contrato === 1 ? 'ano' : 'anos'}</p>
                                </div>
                              )}
                              {cpe.dbl && (
                                <div>
                                  <span className="text-muted-foreground text-xs">DBL:</span>
                                  <p className="font-medium">{cpe.dbl} €/MWh</p>
                                </div>
                              )}
                              {cpe.margem && (
                                <div>
                                  <span className="text-muted-foreground text-xs flex items-center gap-1">
                                    <TrendingUp className="h-3 w-3" /> Margem:
                                  </span>
                                  <p className="font-medium text-green-600 dark:text-green-400">{formatCurrency(Number(cpe.margem))}</p>
                                </div>
                              )}
                              {cpe.comissao && (
                                <div>
                                  <span className="text-muted-foreground text-xs">Comissão:</span>
                                  <p className="font-medium text-primary">{formatCurrency(Number(cpe.comissao))}</p>
                                </div>
                              )}
                              {(cpe.contrato_inicio || cpe.contrato_fim) && (
                                <div className="col-span-2 flex items-center gap-4 pt-2 border-t border-amber-200 dark:border-amber-700 mt-1">
                                  <CalendarDays className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                  {cpe.contrato_inicio && (
                                    <div>
                                      <span className="text-muted-foreground text-xs">Início:</span>
                                      <p className="font-medium text-xs">{cpe.contrato_inicio}</p>
                                    </div>
                                  )}
                                  {cpe.contrato_fim && (
                                    <div>
                                      <span className="text-muted-foreground text-xs">Fim:</span>
                                      <p className="font-medium text-xs">{cpe.contrato_fim}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Serviços telecom */}
                  {isTelecom && proposal.proposal_type === 'servicos' && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="space-y-3 p-4 rounded-lg border bg-secondary/30 border-border">
                          <div className="flex items-center gap-2 text-foreground">
                            <Wrench className="h-4 w-4" />
                            <span className="font-medium text-sm">Outros Serviços</span>
                          </div>
                          
                          {proposal.modelo_servico && (
                            <div className="text-sm">
                              <span className="text-muted-foreground">Modelo:</span>
                              <Badge variant="outline" className="ml-2">
                                {MODELO_SERVICO_LABELS[proposal.modelo_servico as keyof typeof MODELO_SERVICO_LABELS] || proposal.modelo_servico}
                              </Badge>
                            </div>
                          )}

                          {/* Product details table */}
                          {proposal.servicos_produtos && proposal.servicos_produtos.length > 0 && (() => {
                            const details: ServicosDetails = (proposal as any).servicos_details || {};
                            return (
                              <div className="space-y-2">
                                {proposal.servicos_produtos.map((prod) => {
                                  const d = details[prod];
                                  const config = SERVICOS_PRODUCT_CONFIGS.find(c => c.name === prod);
                                  return (
                                    <div key={prod} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-2 rounded bg-muted/50 text-sm">
                                      <span className="font-medium min-w-[140px]">{prod}</span>
                                      {d && config?.fields.map(field => (
                                        d[field] != null && (
                                          <span key={field} className="text-muted-foreground">
                                            {FIELD_LABELS[field]}: <span className="font-medium text-foreground">{Number(d[field]).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}</span>
                                          </span>
                                        )
                                      ))}
                                      {!d && <span className="text-muted-foreground text-xs">(sem detalhes)</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}

                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm pt-2 border-t border-border/50">
                            {proposal.kwp != null && (
                              <div>
                                <span className="text-muted-foreground">kWp Total:</span>
                                <span className="ml-2 font-medium">{Number(proposal.kwp).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}</span>
                              </div>
                            )}
                            {proposal.comissao != null && (
                              <div>
                                <span className="text-muted-foreground">Comissão:</span>
                                <span className="ml-2 font-medium text-primary">{formatCurrency(proposal.comissao)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Produtos do catálogo */}
                  {(proposalProducts.length > 0 || !isTelecom) && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Produtos/Serviços</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-2">
                        {productsFetching && !productsLoaded && <p className="text-sm text-muted-foreground">A carregar produtos...</p>}
                        {productsError && <p className="text-sm text-destructive">Não foi possível carregar os produtos. Volta a abrir a proposta.</p>}
                        {missingLineItems && (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                            <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Detalhe dos produtos em falta</p>
                            <p className="mt-1">Esta proposta tem um valor guardado, mas não tem produto, quantidade ou preço unitário registados. Adiciona os produtos em Editar antes de imprimir, enviar ou aceitar.</p>
                          </div>
                        )}
                        {!productsFetching && productsLoaded && proposalProducts.length === 0 && !missingLineItems && (
                          <p className="text-sm text-muted-foreground">Ainda não há produtos associados a esta proposta.</p>
                        )}
                        {proposalProducts.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                          >
                            <div>
                              <p className="font-medium text-sm">{item.product?.name || 'Produto'}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.quantity} × {formatCurrency(item.unit_price)}
                              </p>
                            </div>
                            <p className="font-semibold">{formatCurrency(item.total)}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Observações */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Observações da Negociação</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <Textarea
                        id="proposal-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        onBlur={handleNotesBlur}
                        placeholder="Notas internas sobre a negociação..."
                        rows={3}
                      />
                    </CardContent>
                  </Card>

                  {/* Faturas Anexadas da Lead - Telecom only */}
                  {isTelecom && proposal.lead_id && (
                    <Card>
                      <CardContent className="p-4">
                        <LeadAttachments leadId={proposal.lead_id} readOnly />
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* RIGHT COLUMN (40%) - Sticky */}
                <div className="lg:col-span-2">
                  <div className="lg:sticky lg:top-6 space-y-4">
                    {/* Valor Total */}
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 text-center">
                          {showEnergy ? (
                            <>
                              <p className="text-sm text-muted-foreground mb-1">Consumo Total</p>
                              <p className="text-2xl font-bold text-primary">
                                {(recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.consumo_anual) || 0), 0) / 1000).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} MWh
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm text-muted-foreground mb-1">Valor Total</p>
                              <p className="text-2xl font-bold text-primary">
                                {formatCurrency(proposal.total_value)}
                              </p>
                            </>
                          )}
                        </div>

                        {/* Resumo Telecom */}
                        {showEnergy && (
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Consumo Total</span>
                              <span className="font-medium">{(recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.consumo_anual) || 0), 0) / 1000).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} MWh</span>
                            </div>
                            {proposal.proposal_type === 'energia' && recalculatedCpes.length > 0 && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Margem Total</span>
                                  <span className="font-medium text-green-600 dark:text-green-400">{formatCurrency(recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.margem) || 0), 0))}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Comissão Total</span>
                                  <span className="font-medium">{formatCurrency(recalculatedCpes.reduce((sum, cpe) => sum + (Number(cpe.comissao) || 0), 0))}</span>
                                </div>
                              </>
                            )}
                            {proposal.proposal_type === 'servicos' && (
                              <>
                                {proposal.kwp != null && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">kWp</span>
                                    <span className="font-medium">{Number(proposal.kwp).toLocaleString('pt-PT')}</span>
                                  </div>
                                )}
                                {proposal.comissao != null && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Comissão</span>
                                    <span className="font-medium">{formatCurrency(Number(proposal.comissao))}</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Ações */}
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Ações</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => setShowEditModal(true)}
                          disabled={hasCompletedSale}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start"
                          onClick={handlePrint}
                          disabled={!canOutputProposal}
                        >
                          <Printer className="h-4 w-4 mr-2" />
                          Imprimir
                        </Button>
                        <EmailTemplateGate triggerType={EMAIL_TEMPLATE_TRIGGERS.proposal}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start"
                            onClick={handleSendEmail}
                            disabled={!canSendEmail}
                          >
                            {sendProposalEmail.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Mail className="h-4 w-4 mr-2" />
                            )}
                            {!isBrevoConfigured ? 'Configurar Email' : 'Enviar Email'}
                          </Button>
                        </EmailTemplateGate>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => setShowDeleteConfirm(true)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Eliminar
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="p-4 border-t border-border/50 shrink-0">
            <div className="flex gap-3 max-w-6xl mx-auto justify-end">
              <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar proposta?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem a certeza que pretende eliminar esta proposta? Esta ação não pode ser revertida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
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
