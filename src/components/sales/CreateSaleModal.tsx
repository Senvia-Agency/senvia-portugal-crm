import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/searchable-combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Progress } from "@/components/ui/progress";
// Lead removido - vendas são apenas para clientes
import { useProposals, useProposalProducts } from "@/hooks/useProposals";
import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from "@/types/proposals";
import { useProposalCpes } from "@/hooks/useProposalCpes";
import { useClients } from "@/hooks/useClients";
import { useProducts } from "@/hooks/useProducts";
import { useCreateSale } from "@/hooks/useSales";
import { useCreateSaleItems } from "@/hooks/useSaleItems";
import { useCreateSalePayment } from "@/hooks/useSalePayments";
import { useCreateCpe, useUpdateCpe } from "@/hooks/useCpes";
import { useAuth } from "@/contexts/AuthContext";
import { useFinalStages } from "@/hooks/usePipelineStages";
import { formatCurrency } from "@/lib/format";
import {
  effectiveProductTaxRate,
  effectiveTaxExemptionReason,
  grossUnitPrice,
  roundCurrency,
  type OrganizationTaxConfig,
} from "@/lib/product-fiscal";
import { getPlanById } from "@/lib/stripe-plans";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useModules } from "@/hooks/useModules";
import { format, addMonths } from "date-fns";
import { BillingRecipientSelector, ClientFiscalCard, VatBadge, useVatCalculation, isInvoiceXpressActive, getOrgTaxValue } from "./SaleFiscalInfo";
import type { BillingTarget } from "@/types/clients";
import { pt } from "date-fns/locale";
import { 
  Loader2, 
  CalendarIcon, 
  Plus, 
  Minus, 
  X, 
  Package, 
  User,
  FileText,
  Router,
  Zap,
  CreditCard,
  Trash2
} from "lucide-react";
import type { Proposal, ServicosProductDetail, ServicosDetails } from "@/types/proposals";
import { NEGOTIATION_TYPE_LABELS, getCatalogCommission, productNeedsTechnologyChoice, productTechnologies } from "@/types/proposals";
import { useServicosProducts } from "@/hooks/useServicosProducts";
import { ServicosSection } from "@/components/proposals/ServicosSection";
import { SellerSelect } from "@/components/sales/SellerSelect";
import { DocumentsCheckboxField, ContractSignedCheckboxField } from "@/components/shared/DocumentsCheckboxField";
import { usePermissions } from '@/hooks/usePermissions';
import { RecurringFiscalSettings } from "@/components/sales/RecurringFiscalSettings";
import { configureSaleRecurrenceFiscal, ensureSaleRecurrenceFromLegacy } from "@/hooks/useSaleRecurrence";
import {
  DEFAULT_RECURRING_FISCAL_CONFIG,
  recurringFiscalConfigError,
  type RecurringFiscalConfig,
} from "@/types/recurring-fiscal";

import { useSaleFieldsSettings } from "@/hooks/useSaleFieldsSettings";
import { normalizeOperationalUnits } from "@/lib/sale-units";
import { useCommissionMatrix, getVolumeTier } from "@/hooks/useCommissionMatrix";
import { 
  type ProposalType,
  type ModeloServico,
  type NegotiationType,
  type PaymentMethod,
  type SaleStatus,
  type TelecomStatus,
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  SALE_STATUSES,
  TELECOM_STATUSES,
  TELECOM_STATUS_LABELS,
  TELECOM_STATUS_HINTS,
  TELECOM_TO_SALE_STATUS,
} from "@/types/sales";

/** Radix Select can't hold an empty string as a value. */
const NO_TELECOM_STATUS = "__none__";
import { StatusBadge } from "@/components/ui/status-badge";
import { paymentRecordStatusBadge } from "@/lib/status-badge-maps";
import { calculatePaymentSummary } from "@/hooks/useSalePayments";
import { AddDraftPaymentModal, type DraftPayment } from "./AddDraftPaymentModal";
import { PaymentTypeSelector } from "./PaymentTypeSelector";
import { DraftScheduleModal } from "./DraftScheduleModal";


interface SaleItemDraft {
  id: string;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  first_due_date?: Date | null; // Data de vencimento para produtos recorrentes
}

interface PrefillSaleClient {
  id: string;
  name: string;
  code?: string | null;
  email?: string | null;
  company?: string | null;
  nif?: string | null;
  company_nif?: string | null;
  company_address_same_as_client?: boolean | null;
  company_address_line1?: string | null;
  company_city?: string | null;
  company_postal_code?: string | null;
  company_country?: string | null;
  billing_target?: BillingTarget | null;
  address_line1?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

interface CreateSaleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillProposal?: Proposal | null;
  prefillClientId?: string | null;
  prefillClient?: PrefillSaleClient | null;
  onSaleCreated?: (saleId: string) => void;
}

export function CreateSaleModal({ 
  open, 
  onOpenChange, 
  prefillProposal,
  prefillClientId,
  prefillClient,
  onSaleCreated
}: CreateSaleModalProps) {
  // Lead removido - vendas são apenas para clientes
  const { data: proposals } = useProposals();
  const { data: clients } = useClients();
  const { data: products } = useProducts();
  const createSale = useCreateSale();
  const createSaleItems = useCreateSaleItems();
  const createSalePayment = useCreateSalePayment();
  const createCpe = useCreateCpe();
  const updateCpe = useUpdateCpe();
  const { finalPositiveStage } = useFinalStages();
  const { organization, user } = useAuth();
  const { can } = usePermissions();
  const canConfigureFiscal = can('finance', 'invoices', 'issue');
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  const isSenviaOrg = organization?.id === '06fe9e1d-9670-45b0-8717-c5a6e90be380';
  const { data: saleFields } = useSaleFieldsSettings();
  const { calculateCommission, isAutoCalculated, calculateEnergyCommission, hasEnergyConfig, energyConfig } = useCommissionMatrix();
  const { products: catalogProductNames, configs: servicosConfigs, catalog, isNewFormat, operators: catalogOperators } = useServicosProducts();
  
  // Fiscal info
  const ixActive = isInvoiceXpressActive(organization);
  const keyInvoiceActive = (organization?.integrations_enabled as Record<string, boolean> | null)?.keyinvoice === true
    && organization?.tem_keyinvoice_password === true
    && organization?.billing_provider === 'keyinvoice';
  const orgTaxValue = getOrgTaxValue(organization);
  const organizationTaxConfig = organization?.tax_config as OrganizationTaxConfig | null | undefined;
  
  // State para proposta selecionada manualmente (para buscar produtos)
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  
  // Gate queries by modal open state - ensures fresh data when modal opens
  const effectiveProposalId = open ? (prefillProposal?.id || selectedProposalId || undefined) : undefined;
  
  // Fetch proposal products - usa prefill OU seleção manual, gated by open
  const { data: proposalProducts } = useProposalProducts(effectiveProposalId);
  
  // Fetch proposal CPEs - usa prefill OU seleção manual, gated by open
  const { data: rawProposalCpes = [] } = useProposalCpes(effectiveProposalId);

  // Recalculate energy CPE commissions using current tier rules
  const proposalCpes = useMemo(() => {
    if (!hasEnergyConfig || rawProposalCpes.length === 0) return rawProposalCpes;
    return rawProposalCpes.map(cpe => {
      if (!cpe.margem || !cpe.consumo_anual) return cpe;
      const margem = Number(cpe.margem);
      if (margem <= 0) return cpe;
      const calc = calculateEnergyCommission(margem, getVolumeTier(Number(cpe.consumo_anual) || 0));
      if (calc === null) return cpe;
      return { ...cpe, comissao: calc };
    });
  }, [rawProposalCpes, hasEnergyConfig, calculateEnergyCommission]);

  // Form state
  const [clientId, setClientId] = useState<string>("");
  const [billingTarget, setBillingTarget] = useState<BillingTarget>('client');
  const [proposalId, setProposalId] = useState<string>("");
  const [saleDate, setSaleDate] = useState<Date>(new Date());
  // Who the sale belongs to. Defaults to whoever is creating it — an admin
  // reassigns it explicitly when entering a sale on someone else's behalf.
  const [sellerId, setSellerId] = useState<string | null>(user?.id ?? null);
  const [telecomStatus, setTelecomStatus] = useState<TelecomStatus | "">("");
  const [scheduledInstallDate, setScheduledInstallDate] = useState<string>("");
  // Picking a date shouldn't leave the calendar hanging open over the time
  // fields it reveals right below it.
  const [installDatePopoverOpen, setInstallDatePopoverOpen] = useState(false);
  const [scheduledInstallTime, setScheduledInstallTime] = useState<string>("");
  const [scheduledInstallEndTime, setScheduledInstallEndTime] = useState<string>("");
  const [documentsChecked, setDocumentsChecked] = useState(false);
  const [contractSigned, setContractSigned] = useState(false);
  const [items, setItems] = useState<SaleItemDraft[]>([]);
  const [discount, setDiscount] = useState<string>("0");
  // What this sale will pay the person it is assigned to, reported up by
  // ServicosSection. In telecom the summary shows this, not the price: the
  // client pays the operator, so the sale's own value is money nobody here
  // ever sees.
  const [sellerCommissionTotal, setSellerCommissionTotal] = useState(0);
  const [notes, setNotes] = useState("");
  
  // Track which proposal we've already initialized items for
  const [initializedProposalId, setInitializedProposalId] = useState<string | null>(null);
  
  // Campos específicos de proposta (Energia / Serviços)
  const [proposalType, setProposalType] = useState<ProposalType | null>(null);
  const [consumoAnual, setConsumoAnual] = useState<string>("");
  const [margem, setMargem] = useState<string>("");
  const [dbl, setDbl] = useState<string>("");
  const [anosContrato, setAnosContrato] = useState<string>("");
  // When the contract's loyalty period ends (telecom) — yyyy-MM-dd.
  const [fidelizacaoEnd, setFidelizacaoEnd] = useState<string>("");
  const [modeloServico, setModeloServico] = useState<ModeloServico | null>(null);
  const [kwp, setKwp] = useState<string>("");
  const [comissao, setComissao] = useState<string>("");
  const [negotiationType, setNegotiationType] = useState<NegotiationType | null>(null);
  const [servicosProdutos, setServicosProdutos] = useState<string[]>([]);
  const [servicosDetails, setServicosDetails] = useState<ServicosDetails>({});

  // Sale status
  const [saleStatus, setSaleStatus] = useState<SaleStatus>("fulfilled");
  const [edpProposalNumber, setEdpProposalNumber] = useState("");
  const [activationDate, setActivationDate] = useState<Date | undefined>(undefined);

  // Draft payments state
  const [draftPayments, setDraftPayments] = useState<DraftPayment[]>([]);
  const [showDraftPaymentModal, setShowDraftPaymentModal] = useState(false);
  const [showPaymentTypeSelector, setShowPaymentTypeSelector] = useState(false);
  const [showDraftScheduleModal, setShowDraftScheduleModal] = useState(false);

  // Plan sale mode (Senvia only)
  const [isPlanSale, setIsPlanSale] = useState(false);
  // selectedPlanId removed — plan value comes from Stripe automatically
  const [clientOrgId, setClientOrgId] = useState<string>("");
  const [orgSearchResults, setOrgSearchResults] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [orgSearchTerm, setOrgSearchTerm] = useState("");
  const [recurringFiscalConfig, setRecurringFiscalConfig] = useState<RecurringFiscalConfig>({
    ...DEFAULT_RECURRING_FISCAL_CONFIG,
    fiscal_email_config: { ...DEFAULT_RECURRING_FISCAL_CONFIG.fiscal_email_config },
  });
  

  // Helper to recalculate commission from proposal data using matrix
  const recalcComissaoFromProposal = (proposal: Proposal): number | null => {
    if (proposal.proposal_type !== 'servicos') return null;
    const produtos = proposal.servicos_produtos || [];
    const details = (proposal as any).servicos_details || {};
    const ms = proposal.modelo_servico || null;
    let total = 0;
    let anyCalc = false;
    for (const prodName of produtos) {
      const detail: ServicosProductDetail = details[prodName] || { kwp: proposal.kwp, valor: proposal.total_value };
      const calc = calculateCommission(prodName, detail, ms ?? undefined);
      if (calc !== null) {
        total += Math.round(calc * 100) / 100;
        anyCalc = true;
      } else if (detail.comissao != null) {
        total += detail.comissao;
      }
    }
    return anyCalc ? total : null;
  };

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      // Reset initialization tracker
      setInitializedProposalId(null);
      
      // If prefillProposal is provided, pre-populate fields
      if (prefillProposal) {
        setProposalId(prefillProposal.id);
        setSelectedProposalId(null); // Não precisa, já vem do prefill
        
        // Find client by client_id or lead_id (retrocompatibilidade)
        if (prefillProposal.client_id) {
          setClientId(prefillProposal.client_id);
        } else if (prefillProposal.lead_id) {
          const client = clients?.find(c => c.lead_id === prefillProposal.lead_id);
          if (client) {
            setClientId(client.id);
          }
        }
        
        // Preencher notas da proposta
        if (prefillProposal.notes) {
          setNotes(prefillProposal.notes);
        }
        
        // Preencher campos específicos de Energia/Serviços
        setProposalType(prefillProposal.proposal_type || null);
        setConsumoAnual(prefillProposal.consumo_anual?.toString() || "");
        setMargem(prefillProposal.margem?.toString() || "");
        setDbl(prefillProposal.dbl?.toString() || "");
        setAnosContrato(prefillProposal.anos_contrato?.toString() || "");
        setModeloServico(prefillProposal.modelo_servico || null);
        setKwp(prefillProposal.kwp?.toString() || "");
        setNegotiationType(prefillProposal.negotiation_type || null);
        setServicosProdutos(prefillProposal.servicos_produtos || []);
        setServicosDetails((prefillProposal as any).servicos_details || {});
        // Recalculate commission using matrix
        const recalcedComissao = recalcComissaoFromProposal(prefillProposal);
        setComissao(recalcedComissao !== null ? recalcedComissao.toString() : (prefillProposal.comissao?.toString() || ""));
      } else if (prefillClientId) {
        setClientId(prefillClientId);
        setSelectedProposalId(null);
        // Reset campos específicos
        setProposalType(null);
        setConsumoAnual("");
        setMargem("");
        setDbl("");
        setAnosContrato("");
        setModeloServico(null);
        setKwp("");
        setComissao("");
        setNegotiationType(null);
        setServicosProdutos([]);
        setServicosDetails({});
      } else {
        setClientId("");
        setProposalId("");
        setSelectedProposalId(null);
        // Reset campos específicos
        setProposalType(null);
        setConsumoAnual("");
        setMargem("");
        setDbl("");
        setAnosContrato("");
        setModeloServico(null);
        setKwp("");
        setComissao("");
        setNegotiationType(null);
        setServicosProdutos([]);
        setServicosDetails({});
      }
      
      setSaleDate(new Date());
      // Para telecom, quando vem de proposta, estado padrão = fulfilled (Entregue)
      setSaleStatus('fulfilled');
      setEdpProposalNumber("");
      setActivationDate(undefined);
      setItems([]);
      setDiscount("0");
      setDraftPayments([]);
      setShowDraftPaymentModal(false);
      setShowPaymentTypeSelector(false);
      setShowDraftScheduleModal(false);
      setIsPlanSale(false);
      // selectedPlanId removed
      setClientOrgId("");
      setOrgSearchTerm("");
      setOrgSearchResults([]);
      setRecurringFiscalConfig({
        ...DEFAULT_RECURRING_FISCAL_CONFIG,
        fiscal_email_config: { ...DEFAULT_RECURRING_FISCAL_CONFIG.fiscal_email_config },
      });
      if (!prefillProposal?.notes) {
        setNotes("");
      }
    } else {
      // Reset when modal closes
      setInitializedProposalId(null);
    }
  }, [open, prefillProposal, prefillClientId, clients]);

  // Load proposal products/value when available (prefill ou seleção manual)
  useEffect(() => {
    if (!open) return;
    
    const currentProposalId = prefillProposal?.id || selectedProposalId;
    
    // Skip if already initialized for this proposal
    if (currentProposalId && initializedProposalId === currentProposalId) {
      return;
    }
    
    // Se há produtos da proposta, usar esses
    if (proposalProducts && proposalProducts.length > 0) {
      const newItems: SaleItemDraft[] = proposalProducts.map(pp => ({
        id: crypto.randomUUID(),
        product_id: pp.product_id,
        name: pp.product?.name || "Produto",
        quantity: pp.quantity,
        unit_price: pp.unit_price,
      }));
      setItems(newItems);
      if (currentProposalId) {
        setInitializedProposalId(currentProposalId);
      }
    } 
    else if (prefillProposal && prefillProposal.total_value > 0 && proposalProducts !== undefined) {
      const itemName = prefillProposal.proposal_type === 'energia' 
        ? 'Contrato de Energia' 
        : prefillProposal.proposal_type === 'servicos'
          ? 'Serviços'
          : 'Proposta ' + (prefillProposal.code || '');
      
      setItems([{
        id: crypto.randomUUID(),
        product_id: null,
        name: itemName,
        quantity: 1,
        unit_price: prefillProposal.total_value,
      }]);
      setInitializedProposalId(prefillProposal.id);
    }
    else if (selectedProposalId && proposalProducts !== undefined && proposalProducts.length === 0) {
      const selectedProposal = proposals?.find(p => p.id === selectedProposalId);
      if (selectedProposal && selectedProposal.total_value > 0) {
        const itemName = selectedProposal.proposal_type === 'energia' 
          ? 'Contrato de Energia' 
          : selectedProposal.proposal_type === 'servicos'
            ? 'Serviços'
            : 'Proposta ' + (selectedProposal.code || '');
        
        setItems([{
          id: crypto.randomUUID(),
          product_id: null,
          name: itemName,
          quantity: 1,
          unit_price: selectedProposal.total_value,
        }]);
        setInitializedProposalId(selectedProposalId);
      }
    }
  }, [open, proposalProducts, prefillProposal, selectedProposalId, initializedProposalId, proposals]);

  // Auto-fill plan price when selecting client org for plan sale
  useEffect(() => {
    if (!isPlanSale || !clientOrgId) return;
    supabase
      .from("organizations")
      .select("plan")
      .eq("id", clientOrgId)
      .single()
      .then(({ data }) => {
        const plan = data?.plan ? getPlanById(data.plan) : null;
        if (plan) {
          setItems([{
            id: crypto.randomUUID(),
            product_id: null,
            name: `Plano ${plan.name}`,
            quantity: 1,
            unit_price: plan.priceMonthly,
          }]);
        }
      });
  }, [clientOrgId, isPlanSale]);

  const filteredProposals = useMemo(() => {
    if (!proposals) return [];
    
    let filtered = proposals.filter(p => p.status === 'accepted');
    
    // Excluir propostas que já têm venda associada (exceto a do prefill)
    filtered = filtered.filter(p => 
      p.id === prefillProposal?.id || 
      !p.has_sale
    );
    
    if (prefillProposal && !filtered.find(p => p.id === prefillProposal.id)) {
      filtered = [prefillProposal, ...filtered];
    }
    
    if (clientId) {
      const client = clients?.find(c => c.id === clientId);
      filtered = filtered.filter(p => 
        p.client_id === clientId || (client?.lead_id && p.lead_id === client.lead_id) ||
        p.id === prefillProposal?.id
      );
    }
    
    return filtered;
  }, [proposals, clients, clientId, prefillProposal]);

  const getProposalStatusLabel = (status: string) => {
    return PROPOSAL_STATUS_LABELS[status as ProposalStatus] || status;
  };

  // Org search for plan sales
  useEffect(() => {
    if (!isPlanSale || orgSearchTerm.length < 2) {
      setOrgSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await (await import("@/integrations/supabase/client")).supabase
        .rpc("search_organizations_by_name", {
          _caller_org_id: organization?.id || "",
          _search: orgSearchTerm,
          _limit: 10,
        });
      setOrgSearchResults((data as { id: string; name: string; slug: string }[]) || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [orgSearchTerm, isPlanSale, organization?.id]);

  // Plan sale no longer needs plan selection - value comes from Stripe automatically

  // Calculate totals from catalog products (telecom) 
  const catalogTotalPrice = useMemo(() => {
    if (!isTelecom || !isNewFormat) return 0;
    return servicosProdutos.reduce((sum, p) => sum + (servicosDetails[p]?.price || 0), 0);
  }, [isTelecom, isNewFormat, servicosProdutos, servicosDetails]);

  const catalogTotalComissao = useMemo(() => {
    if (!isTelecom || !isNewFormat) return 0;
    return servicosProdutos.reduce((sum, p) => sum + (servicosDetails[p]?.comissao || 0), 0);
  }, [isTelecom, isNewFormat, servicosProdutos, servicosDetails]);

  // Which operator(s) this sale is actually being sold under — from the
  // frozen operator on each product line, falling back to the catalog for
  // lines added before that was recorded. Drives the proposal-number field:
  // there is no "EDP number" unless the sale is an EDP one.
  const saleOperatorNames = useMemo(() => {
    const names = new Set<string>();
    for (const productName of servicosProdutos) {
      const detail = servicosDetails[productName];
      const operatorId = detail?.operator_id
        ?? catalog?.find((c) => c.name === productName)?.operator_id;
      const name = detail?.operator_name
        ?? (operatorId ? catalogOperators.find((o) => o.id === operatorId)?.name : undefined);
      if (name) names.add(name);
    }
    return [...names];
  }, [servicosProdutos, servicosDetails, catalog, catalogOperators]);

  // Auto-sync comissao from catalog products
  useEffect(() => {
    if (isTelecom && isNewFormat && !proposalId && servicosProdutos.length > 0) {
      setComissao(catalogTotalComissao.toString());
    }
  }, [isTelecom, isNewFormat, proposalId, catalogTotalComissao, servicosProdutos]);

  // Calculate totals
  const enteredSubtotal = useMemo(() => {
    const itemsTotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    // For telecom direct sales with catalog, use catalog price as subtotal
    if (isTelecom && isNewFormat && !proposalId && servicosProdutos.length > 0 && itemsTotal === 0) {
      return catalogTotalPrice;
    }
    return itemsTotal;
  }, [items, isTelecom, isNewFormat, proposalId, servicosProdutos, catalogTotalPrice]);

  const discountValue = parseFloat(discount) || 0;
  const vatCalc = useVatCalculation({
    items, products, orgTaxValue, discount: discountValue, subtotal: enteredSubtotal,
  });
  const subtotal = isTelecom ? enteredSubtotal : vatCalc.subtotalWithoutVat;
  const total = isTelecom ? Math.max(0, enteredSubtotal - discountValue) : vatCalc.totalWithoutVat;
  const grossValue = isTelecom
    ? total
    : isPlanSale
      ? Math.max(0, enteredSubtotal - discountValue)
      : vatCalc.totalWithVat;
  const recurringValuePreview = useMemo(() => {
    if (isPlanSale) return Math.max(0, enteredSubtotal - discountValue);
    return items.reduce((sum, item) => {
      if (!item.product_id) return sum;
      const product = products?.find((candidate) => candidate.id === item.product_id);
      if (!product?.is_recurring) return sum;
      return sum + item.quantity * grossUnitPrice(item.unit_price, product, organizationTaxConfig);
    }, 0);
  }, [isPlanSale, enteredSubtotal, discountValue, items, products, organizationTaxConfig]);
  const hasRecurringItems = isPlanSale || recurringValuePreview > 0;
  const hasRecurringRetention = useMemo(() => items.some((item) => {
    if (!item.product_id) return false;
    const product = products?.find((candidate) => candidate.id === item.product_id);
    return product?.is_recurring === true && (product.retention_rate ?? 0) > 0;
  }), [items, products]);

  const clientOptions = useMemo<ComboboxOption[]>(() => {
    const mappedClients = (clients || []).map((client): ComboboxOption => ({
      value: client.id,
      label: client.name,
      sublabel: client.code || client.email || undefined,
    }));

    if (
      prefillClient &&
      prefillClient.id &&
      !mappedClients.some((client) => client.value === prefillClient.id)
    ) {
      mappedClients.unshift({
        value: prefillClient.id,
        label: prefillClient.name,
        sublabel: prefillClient.code || prefillClient.email || undefined,
      });
    }

    return mappedClients;
  }, [clients, prefillClient]);

  // Selected client fiscal data
  const selectedClient = useMemo(() => {
    if (!clientId) return null;
    return clients?.find(c => c.id === clientId) || (prefillClient?.id === clientId ? prefillClient : null);
  }, [clientId, clients, prefillClient]);

  useEffect(() => {
    if (!open) return;
    setBillingTarget(selectedClient?.billing_target === 'company' ? 'company' : 'client');
  }, [open, selectedClient?.id, selectedClient?.billing_target]);

  // Handlers
  const handleClientSelect = (value: string) => {
    if (value === "none") {
      setClientId("");
      return;
    }
    setClientId(value);
    if (proposalId) {
      const proposal = proposals?.find(p => p.id === proposalId);
      const client = clients?.find(c => c.id === value);
      if (proposal && proposal.client_id !== value && proposal.lead_id !== client?.lead_id) {
        setProposalId("");
      }
    }
  };

  const handleProposalSelect = (value: string) => {
    if (value === "none") {
      setProposalId("");
      setSelectedProposalId(null);
      setItems([]);
      setNotes("");
      setProposalType(null);
      setConsumoAnual("");
      setMargem("");
      setDbl("");
      setAnosContrato("");
      setModeloServico(null);
      setKwp("");
      setComissao("");
      setNegotiationType(null);
      setServicosProdutos([]);
      setServicosDetails({});
      return;
    }
    
    setProposalId(value);
    setSelectedProposalId(value);
    
    const proposal = proposals?.find(p => p.id === value);
    if (proposal) {
      if (!clientId) {
        if (proposal.client_id) {
          setClientId(proposal.client_id);
        } else if (proposal.lead_id) {
          const client = clients?.find(c => c.lead_id === proposal.lead_id);
          if (client) {
            setClientId(client.id);
          }
        }
      }
      
      if (proposal.notes) {
        setNotes(proposal.notes);
      }
      
      setProposalType(proposal.proposal_type || null);
      setConsumoAnual(proposal.consumo_anual?.toString() || "");
      setMargem(proposal.margem?.toString() || "");
      setDbl(proposal.dbl?.toString() || "");
      setAnosContrato(proposal.anos_contrato?.toString() || "");
      setModeloServico(proposal.modelo_servico || null);
      setKwp(proposal.kwp?.toString() || "");
      setNegotiationType(proposal.negotiation_type || null);
      setServicosProdutos(proposal.servicos_produtos || []);
      setServicosDetails((proposal as any).servicos_details || {});
      
      // Recalculate commission using matrix
      const recalcedComissao = recalcComissaoFromProposal(proposal);
      setComissao(recalcedComissao !== null ? recalcedComissao.toString() : (proposal.comissao?.toString() || ""));
      
      setItems([]);
    }
  };

  const handleAddProduct = (productId: string) => {
    const product = products?.find(p => p.id === productId);
    if (!product) return;

    const existing = items.find(i => i.product_id === productId);
    if (existing) {
      setItems(items.map(i => 
        i.product_id === productId 
          ? { ...i, quantity: i.quantity + 1 }
          : i
      ));
    } else {
      setItems([...items, {
        id: crypto.randomUUID(),
        product_id: product.id,
        name: product.name,
        quantity: 1,
        unit_price: product.price || 0,
      }]);
    }
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setItems(items.map(i => {
      if (i.id === itemId) {
        const newQty = normalizeOperationalUnits(i.quantity + delta);
        return { ...i, quantity: newQty };
      }
      return i;
    }));
  };

  const handleUpdatePrice = (itemId: string, price: string) => {
    setItems(items.map(i => {
      if (i.id === itemId) {
        const product = i.product_id ? products?.find((candidate) => candidate.id === i.product_id) : undefined;
        if (product?.is_recurring) return i;
        return { ...i, unit_price: parseFloat(price) || 0 };
      }
      return i;
    }));
  };

  const handleRemoveItem = (itemId: string) => {
    setItems(items.filter(i => i.id !== itemId));
  };

  const handleUpdateDueDate = (itemId: string, date: Date | undefined) => {
    setItems(items.map(i => 
      i.id === itemId 
        ? { ...i, first_due_date: date || null }
        : i
    ));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // No value check here. A sale can be worth 0 € — a telecom contract the
    // operator pays for, a free installation, a replacement, a gift. This
    // used to `return` with no message at all, so the form simply did
    // nothing and nobody could tell why.

    // Validate plan sale
    if (isPlanSale && !clientOrgId) {
      toast.error("Selecione a organização cliente para a venda de plano.");
      return;
    }


    // A product sold as both Fibra and Satélite pays a different commission
    // for each, so the line cannot be priced until someone says which one was
    // installed. Blocking here beats freezing the wrong rate onto the sale.
    const semTecnologia = servicosProdutos.filter((p) => {
      const detail = servicosDetails[p];
      const cat = catalog?.find((c) => c.name === p && (detail?.operator_id ? c.operator_id === detail.operator_id : !c.operator_id))
        ?? catalog?.find((c) => c.name === p);
      return productNeedsTechnologyChoice(cat ? productTechnologies(cat) : undefined) && !detail?.tecnologia;
    });
    if (semTecnologia.length > 0) {
      toast.error(`Escolhe a tecnologia (Fibra ou Satélite) em: ${semTecnologia.join(", ")}.`);
      return;
    }
    // Date sanity for energy/telecom contracts.
    for (const cpe of proposalCpes) {
      if (cpe.contrato_inicio && cpe.contrato_fim && cpe.contrato_inicio > cpe.contrato_fim) {
        toast.error(`CPE ${cpe.serial_number || ""}: o início do contrato é depois do fim.`);
        return;
      }
    }
    if (isTelecom && activationDate) {
      const activationStr = format(activationDate, 'yyyy-MM-dd');
      const fims = proposalCpes.map((c) => c.contrato_fim).filter(Boolean) as string[];
      if (fims.length > 0 && activationStr > fims.reduce((a, b) => (a > b ? a : b))) {
        toast.error("A data de ativação é posterior ao fim do contrato.");
        return;
      }
    }
    const recurringPriceMismatch = items.find((item) => {
      if (!item.product_id) return false;
      const product = products?.find((candidate) => candidate.id === item.product_id);
      return product?.is_recurring === true
        && product.price != null
        && Math.abs(item.unit_price - product.price) >= 0.005;
    });
    if (recurringPriceMismatch) {
      toast.error(`O preço recorrente de ${recurringPriceMismatch.name} mudou no catálogo. Remove e adiciona o produto novamente antes de criar a venda.`);
      return;
    }

    try {
      // For plan sales, force recurring (no plan selection needed, value comes from Stripe)
      const recurringValue = roundCurrency(recurringValuePreview);
      const hasRecurring = hasRecurringItems;

      if (hasRecurring && recurringFiscalConfig.fiscal_mode === 'automatic' && !keyInvoiceActive) {
        toast.error('Liga e configura o KeyInvoice antes de ativar a emissão fiscal automática.');
        return;
      }
      if (hasRecurring && recurringFiscalConfig.fiscal_mode === 'automatic' && hasRecurringRetention) {
        toast.error('Produtos com retenção ficam em emissão fiscal manual até este cenário estar homologado no KeyInvoice.');
        return;
      }

      if (hasRecurring && recurringFiscalConfig.fiscal_auto_email) {
        const emailValidationError = recurringFiscalConfigError(recurringFiscalConfig);
        if (emailValidationError) {
          toast.error(emailValidationError);
          return;
        }
        const emailConfig = recurringFiscalConfig.fiscal_email_config;
        const recipientMissing = emailConfig.recipient_mode === 'custom'
          ? !emailConfig.recipient_email.trim()
          : !(selectedClient?.email || emailConfig.fallback_email.trim());
        if (recipientMissing) {
          toast.error('Define um destinatário ou um email alternativo para o envio dos documentos.');
          return;
        }
        const resolvedSenderEmail = emailConfig.sender_email.trim()
          || organization?.brevo_sender_email?.trim();
        if (organization?.tem_brevo_api_key !== true || !resolvedSenderEmail) {
          toast.error('Liga a Brevo e configura um email de remetente antes de ativar o envio fiscal automático.');
          return;
        }
      }
      // For plan sales, don't set renewal date — it will be set by Stripe webhook on first payment
      const nextRenewalDate = isPlanSale 
        ? undefined 
        : (hasRecurring ? addMonths(saleDate, 1).toISOString().split('T')[0] : undefined);

      const sale = await createSale.mutateAsync({
        client_id: clientId || undefined,
        billing_target: billingTarget,
        proposal_id: proposalId || undefined,
        status: saleStatus,
        total_value: total,
        gross_value: grossValue,
        subtotal: subtotal,
        discount: discountValue,
        sale_date: format(saleDate, 'yyyy-MM-dd'),
        seller_id: sellerId,
        notes: notes.trim() || undefined,
        ...(isTelecom ? {
          proposal_type: proposalType || (servicosProdutos.length > 0 ? 'servicos' : undefined),
          consumo_anual: parseFloat(consumoAnual) || undefined,
          margem: parseFloat(margem) || undefined,
          dbl: parseFloat(dbl) || undefined,
          anos_contrato: parseInt(anosContrato) || undefined,
          fidelizacao_end: fidelizacaoEnd || undefined,
          modelo_servico: modeloServico || undefined,
          kwp: parseFloat(kwp) || undefined,
          comissao: parseFloat(comissao) || undefined,
          negotiation_type: negotiationType || undefined,
          servicos_produtos: servicosProdutos.length > 0 ? servicosProdutos : undefined,
          servicos_details: Object.keys(servicosDetails).length > 0 ? servicosDetails : undefined,
          telecom_status: telecomStatus || undefined,
          scheduled_install_date: scheduledInstallDate
            ? `${scheduledInstallDate}T${scheduledInstallTime || '00:00'}:00`
            : undefined,
          scheduled_install_end: scheduledInstallDate && scheduledInstallEndTime
            ? `${scheduledInstallDate}T${scheduledInstallEndTime}:00`
            : undefined,
          documents_checked: documentsChecked,
          contract_signed: contractSigned,
        } : {}),
        ...(showEnergy && saleFields?.edp_proposal_number?.visible ? { edp_proposal_number: edpProposalNumber.trim() || undefined } : {}),
        // The install is the activation: a sale that is already live takes
        // its booked install day as activation date, nobody types a second one.
        activation_date: activationDate
          ? format(activationDate, 'yyyy-MM-dd')
          : (isTelecom && (telecomStatus === 'ativo' || telecomStatus === 'instalado') && scheduledInstallDate ? scheduledInstallDate : undefined),
        has_recurring: hasRecurring || false,
        recurring_value: recurringValue,
        recurring_status: isPlanSale ? 'pending' : (hasRecurring ? 'active' : undefined),
        next_renewal_date: nextRenewalDate,
        ...(isPlanSale && clientOrgId ? { client_org_id: clientOrgId } : {}),
      });

      if (!isTelecom && items.length > 0 && sale?.id) {
        await createSaleItems.mutateAsync(
          items.map(item => {
            const product = item.product_id
              ? products?.find((candidate) => candidate.id === item.product_id)
              : undefined;
            const frozenTaxValue = product
              ? effectiveProductTaxRate(product.tax_value, organizationTaxConfig)
              : null;
            return {
              sale_id: sale.id,
              product_id: item.product_id,
              name: item.name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              total: item.quantity * item.unit_price,
              first_due_date: item.first_due_date
                ? format(item.first_due_date, 'yyyy-MM-dd')
                : null,
              tax_value: frozenTaxValue,
              tax_exemption_reason: product
                ? effectiveTaxExemptionReason(product.tax_exemption_reason, organizationTaxConfig)
                : null,
              price_includes_vat: product?.price_includes_vat ?? null,
              retention_rate: product?.retention_rate ?? null,
            };
          })
        );
      }

      // Process CPEs
      if (proposalCpes.length > 0 && clientId) {
        for (const proposalCpe of proposalCpes) {
          if (proposalCpe.existing_cpe_id) {
            await updateCpe.mutateAsync({
              id: proposalCpe.existing_cpe_id,
              comercializador: 'EDP Comercial',
              fidelizacao_start: proposalCpe.contrato_inicio || proposalCpe.fidelizacao_start || undefined,
              fidelizacao_end: proposalCpe.contrato_fim || proposalCpe.fidelizacao_end || undefined,
              notes: proposalCpe.notes || undefined,
              status: 'active',
            });
          } else {
            await createCpe.mutateAsync({
              client_id: clientId,
              equipment_type: proposalCpe.equipment_type,
              comercializador: 'EDP Comercial',
              serial_number: proposalCpe.serial_number || undefined,
              fidelizacao_start: proposalCpe.contrato_inicio || proposalCpe.fidelizacao_start || undefined,
              fidelizacao_end: proposalCpe.contrato_fim || proposalCpe.fidelizacao_end || undefined,
              notes: proposalCpe.notes || undefined,
              status: 'active',
            });
          }
        }
      }

      // Create draft payments
      if (!isTelecom && draftPayments.length > 0 && sale?.id && organization?.id) {
        for (const dp of draftPayments) {
          await createSalePayment.mutateAsync({
            sale_id: sale.id,
            organization_id: organization.id,
            amount: dp.amount,
            payment_date: dp.payment_date,
            payment_method: dp.payment_method,
            status: dp.status,
            invoice_reference: dp.invoice_reference,
            notes: dp.notes,
          });
        }
      }

      const hasCustomFiscalConfig =
        recurringFiscalConfig.fiscal_mode !== DEFAULT_RECURRING_FISCAL_CONFIG.fiscal_mode
        || recurringFiscalConfig.fiscal_document_policy !== DEFAULT_RECURRING_FISCAL_CONFIG.fiscal_document_policy
        || recurringFiscalConfig.fiscal_auto_email;

      if (hasRecurring && sale?.id) {
        try {
          // The compatibility RPC creates the recurrence immediately instead
          // of waiting for the daily recurring-sales job. On older databases
          // the fiscal RPC can still be absent; in that case the sale remains
          // safely manual and the user gets an explicit warning.
          const recurrenceId = await ensureSaleRecurrenceFromLegacy(sale.id);
          if (hasCustomFiscalConfig) {
            await configureSaleRecurrenceFiscal(recurrenceId, recurringFiscalConfig);
          }
        } catch (fiscalError) {
          console.error('Recurring fiscal configuration failed:', fiscalError);
          if (hasCustomFiscalConfig) {
            const reason = fiscalError instanceof Error ? fiscalError.message : 'Não foi possível guardar a configuração.';
            toast.warning(`A venda foi criada em modo fiscal manual. ${reason}`);
          }
        }
      }

      onSaleCreated?.(sale.id);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating sale:', error);
    }
  };

  // Deliberately NOT gated on the sale's value. A sale can be worth 0 € —
  // in telecom every catalog product is priced 0, because the client pays
  // the operator and not us, and a whole organization sat looking at a dead
  // grey button that explained nothing. What the sale actually needs is
  // checked on submit, where each rule can say what is missing.

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pr-14 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Nova Venda
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-4 sm:p-6">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* LEFT COLUMN (60%) */}
              <div className="lg:col-span-3 space-y-4">
                {/* Client & Proposal */}
                <Card>
                  <CardHeader className="pb-2 p-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <User className="h-4 w-4" />
                      Informação Básica
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-4">
                    {/* Plan Sale Toggle (Senvia only) */}
                    {isSenviaOrg && !prefillProposal && (
                      <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/20">
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={isPlanSale}
                            onChange={(e) => {
                              setIsPlanSale(e.target.checked);
                              if (!e.target.checked) {
                                setClientOrgId("");
                                setOrgSearchTerm("");
                                setOrgSearchResults([]);
                                setItems([]);
                              }
                            }}
                            className="rounded border-border"
                          />
                          <CreditCard className="h-4 w-4 text-primary" />
                          Venda de Plano Senvia
                        </label>
                      </div>
                    )}

                    {/* Plan Sale Fields — only org search, value comes from Stripe */}
                    {isPlanSale && (
                      <div className="space-y-2">
                        <Label>Organização Cliente</Label>
                        <p className="text-xs text-muted-foreground">O valor da venda será atualizado automaticamente quando o cliente subscrever um plano.</p>
                          <div className="relative">
                            <Input
                              placeholder="Pesquisar organização..."
                              value={orgSearchTerm}
                              onChange={(e) => setOrgSearchTerm(e.target.value)}
                            />
                            {orgSearchResults.length > 0 && !clientOrgId && (
                              <div className="absolute z-50 w-full mt-1 border border-border rounded-lg bg-popover shadow-lg max-h-48 overflow-y-auto">
                                {orgSearchResults.map(org => (
                                  <button
                                    key={org.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                                    onClick={() => {
                                      setClientOrgId(org.id);
                                      setOrgSearchTerm(org.name);
                                      setOrgSearchResults([]);
                                    }}
                                  >
                                    <span className="font-medium">{org.name}</span>
                                    <span className="text-muted-foreground ml-2 text-xs">({org.slug})</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {clientOrgId && (
                              <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2"
                                onClick={() => { setClientOrgId(""); setOrgSearchTerm(""); }}
                              >
                                <X className="h-4 w-4 text-muted-foreground" />
                              </button>
                            )}
                          </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Cliente</Label>
                        <SearchableCombobox
                          options={clientOptions}
                          value={clientId || null}
                          onValueChange={(v) => handleClientSelect(v || "none")}
                          placeholder="Selecionar cliente..."
                          searchPlaceholder="Pesquisar cliente..."
                          emptyLabel="Sem cliente"
                          emptyText="Nenhum cliente encontrado."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Proposta</Label>
                        <SearchableCombobox
                          options={filteredProposals.map((proposal): ComboboxOption => ({
                            value: proposal.id,
                            label: `[${proposal.proposal_type === 'servicos' ? 'Serviços' : 'EE'}] ${proposal.client?.name || proposal.lead?.name || "Proposta"} - ${formatCurrency(proposal.total_value)} (${getProposalStatusLabel(proposal.status)})`,
                            sublabel: proposal.code || undefined,
                          }))}
                          value={proposalId || null}
                          onValueChange={(v) => handleProposalSelect(v || "none")}
                          placeholder="Selecionar proposta..."
                          searchPlaceholder="Pesquisar proposta..."
                          emptyLabel="Venda direta"
                          emptyText="Nenhuma proposta encontrada."
                        />
                      </div>
                    </div>

                    {/* Client Fiscal Card */}
                    {clientId && (
                      <div className="space-y-3">
                        <BillingRecipientSelector client={selectedClient} value={billingTarget} onChange={setBillingTarget} />
                        <ClientFiscalCard client={selectedClient} billingTarget={billingTarget} isInvoiceXpressActive={ixActive} />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Data da Venda</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !saleDate && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {saleDate ? format(saleDate, "PPP", { locale: pt }) : "Selecionar data"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={saleDate}
                              onSelect={(date) => date && setSaleDate(date)}
                              locale={pt}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="space-y-2">
                        <Label>Estado da Venda</Label>
                        {/* Telecom has its own lifecycle and only that one: picking
                            it writes sales.status behind the scenes (see
                            TELECOM_TO_SALE_STATUS) so invoicing and finance keep
                            working, without asking for the same thing twice. */}
                        {isTelecom ? (
                          <Select
                            value={telecomStatus || NO_TELECOM_STATUS}
                            onValueChange={(v) => {
                              const next = v === NO_TELECOM_STATUS ? '' : (v as TelecomStatus);
                              setTelecomStatus(next);
                              if (next) setSaleStatus(TELECOM_TO_SALE_STATUS[next]);
                            }}
                          >
                            <SelectTrigger><SelectValue placeholder="Sem estado" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_TELECOM_STATUS}>Sem estado</SelectItem>
                              {TELECOM_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  <span className="flex flex-col items-start">
                                    <span>{TELECOM_STATUS_LABELS[s]}</span>
                                    {TELECOM_STATUS_HINTS[s] && (
                                      <span className="text-[11px] text-muted-foreground">{TELECOM_STATUS_HINTS[s]}</span>
                                    )}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                        <Select value={saleStatus} onValueChange={(v) => setSaleStatus(v as SaleStatus)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SALE_STATUSES.map(s => (
                              <SelectItem key={s} value={s}>
                                {SALE_STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        )}
                      </div>

                      {/* An admin often types in a sale for someone else — the
                          commission has to follow the seller, not the typist. */}
                      <SellerSelect
                        className="space-y-2"
                        value={sellerId}
                        onChange={setSellerId}
                      />

                      {isTelecom && (
                        <>
                          {/* Full row: the date plus its "das X às Y" window
                              never fits half the grid. */}
                          <div className="space-y-2 col-span-1 sm:col-span-2">
                            <Label>Data de Instalação</Label>
                            <Popover open={installDatePopoverOpen} onOpenChange={setInstallDatePopoverOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !scheduledInstallDate && "text-muted-foreground"
                                  )}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {scheduledInstallDate
                                    ? format(new Date(scheduledInstallDate), "PPP", { locale: pt })
                                    : "Sem data marcada"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={scheduledInstallDate ? new Date(scheduledInstallDate) : undefined}
                                  onSelect={(date) => {
                                    setScheduledInstallDate(date ? format(date, 'yyyy-MM-dd') : '');
                                    setInstallDatePopoverOpen(false);
                                  }}
                                  locale={pt}
                                />
                                {scheduledInstallDate && (
                                  <div className="border-t p-2">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="w-full text-xs"
                                      onClick={() => { setScheduledInstallDate(''); setScheduledInstallTime(''); setScheduledInstallEndTime(''); setInstallDatePopoverOpen(false); }}
                                    >
                                      Limpar data
                                    </Button>
                                  </div>
                                )}
                              </PopoverContent>
                            </Popover>
                            {/* Installs are booked as a window ("das 9h às
                                12h"), so both ends are asked for. */}
                            {scheduledInstallDate && (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs text-muted-foreground shrink-0">das</span>
                                <Input
                                  type="time"
                                  value={scheduledInstallTime}
                                  onChange={(e) => setScheduledInstallTime(e.target.value)}
                                  className="h-9 w-auto"
                                />
                                <span className="text-xs text-muted-foreground shrink-0">às</span>
                                <Input
                                  type="time"
                                  value={scheduledInstallEndTime}
                                  onChange={(e) => setScheduledInstallEndTime(e.target.value)}
                                  className="h-9 w-auto"
                                />
                              </div>
                            )}
                            <p className="text-[11px] text-muted-foreground">Opcional — pode ficar por marcar.</p>
                          </div>

                          {/* Every telecom contract carries a loyalty period; its end is
                              what the renewal alerts (push + email to admins) run off. */}
                          <div className="col-span-1 sm:col-span-2 space-y-2">
                            <Label>Fim da fidelização</Label>
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                type="date"
                                value={fidelizacaoEnd}
                                onChange={(e) => setFidelizacaoEnd(e.target.value)}
                                className="h-9 w-auto"
                              />
                              {(activationDate || scheduledInstallDate) && !fidelizacaoEnd && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-9 text-xs"
                                  onClick={() => {
                                    const base = activationDate ? new Date(activationDate) : new Date(scheduledInstallDate);
                                    base.setFullYear(base.getFullYear() + 2);
                                    setFidelizacaoEnd(format(base, "yyyy-MM-dd"));
                                  }}
                                >
                                  +2 anos
                                </Button>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">Data em que termina a fidelização do contrato. Os alertas de renovação partem daqui.</p>
                          </div>

                          <div className="col-span-1 sm:col-span-2 flex flex-wrap items-center gap-x-8 gap-y-2 pt-1">
                            <DocumentsCheckboxField
                              id="create-sale-documents"
                              checked={documentsChecked}
                              onChange={setDocumentsChecked}
                            />
                            <ContractSignedCheckboxField
                              id="create-sale-contract"
                              checked={contractSigned}
                              onChange={setContractSigned}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Telecom Data Section */}
                {showEnergy && proposalId && (negotiationType || proposalType) && (
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <Zap className="h-4 w-4 text-amber-500" />
                        Dados Energia (da Proposta)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {negotiationType && (
                          <div className="col-span-1 sm:col-span-2">
                            <p className="text-xs text-muted-foreground">Tipo de Negociação</p>
                            <p className="text-sm font-medium">
                              {NEGOTIATION_TYPE_LABELS[negotiationType] || negotiationType}
                            </p>
                          </div>
                        )}

                        {proposalType === 'servicos' && (
                          <>
                            {servicosProdutos.length > 0 && (
                              <div className="col-span-1 sm:col-span-2">
                                <p className="text-xs text-muted-foreground">Serviços/Produtos</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {servicosProdutos.map((s) => (
                                    <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            {modeloServico && (
                              <div>
                                <p className="text-xs text-muted-foreground">Modelo de Serviço</p>
                                <p className="text-sm font-medium">
                                  {modeloServico === 'transacional' ? 'Transacional' : modeloServico === 'saas' ? 'SAAS' : modeloServico}
                                </p>
                              </div>
                            )}
                            {kwp && (
                              <div>
                                <p className="text-xs text-muted-foreground">kWp</p>
                                <p className="text-sm font-medium">{kwp}</p>
                              </div>
                            )}
                            {comissao && (
                              <div>
                                <p className="text-xs text-muted-foreground">Comissão</p>
                                <p className="text-sm font-medium text-green-500">
                                  {formatCurrency(parseFloat(comissao))}
                                </p>
                              </div>
                            )}
                          </>
                        )}

                        {proposalType === 'energia' && proposalCpes.length > 0 && (
                          <>
                            <div>
                              <p className="text-xs text-muted-foreground">Pontos de Consumo</p>
                              <p className="text-sm font-medium">{proposalCpes.length} CPE(s)</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Consumo Total</p>
                              <p className="text-sm font-medium">
                                {(proposalCpes.reduce((sum, c) => sum + (c.consumo_anual || 0), 0) / 1000).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MWh
                              </p>
                            </div>
                            {(() => {
                              const totalComissao = proposalCpes.reduce((sum, c) => sum + (c.comissao || 0), 0);
                              return totalComissao > 0 ? (
                                <div>
                                  <p className="text-xs text-muted-foreground">Comissão Total</p>
                                  <p className="text-sm font-medium text-green-500">
                                    {formatCurrency(totalComissao)}
                                  </p>
                                </div>
                              ) : null;
                            })()}
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Telecom CPE/CUI Details */}
                {showEnergy && proposalCpes.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <Router className="h-4 w-4" />
                        CPE/CUI (Pontos de Consumo)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2">
                      {proposalCpes.map((cpe) => (
                        <div
                          key={cpe.id}
                          className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs">{cpe.equipment_type}</Badge>
                            <Badge variant="secondary" className="text-xs">{cpe.comercializador}</Badge>
                            {negotiationType === 'renovacao' ? (
                              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">Renovação</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-500 border-green-500/30">Novo</Badge>
                            )}
                          </div>
                          {cpe.serial_number && (
                            <div>
                              <p className="text-xs text-muted-foreground">Local de Consumo</p>
                              <p className="text-sm font-mono">{cpe.serial_number}</p>
                            </div>
                          )}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {cpe.consumo_anual != null && (
                              <div>
                                <p className="text-xs text-muted-foreground">Consumo Anual</p>
                                <p className="text-sm font-medium">{cpe.consumo_anual.toLocaleString('pt-PT')} kWh</p>
                              </div>
                            )}
                            {cpe.duracao_contrato != null && (
                              <div>
                                <p className="text-xs text-muted-foreground">Duração</p>
                                <p className="text-sm font-medium">{cpe.duracao_contrato} {cpe.duracao_contrato === 1 ? 'ano' : 'anos'}</p>
                              </div>
                            )}
                            {cpe.dbl != null && (
                              <div>
                                <p className="text-xs text-muted-foreground">DBL</p>
                                <p className="text-sm font-medium">{cpe.dbl.toLocaleString('pt-PT', { minimumFractionDigits: 2 })}</p>
                              </div>
                            )}
                            {cpe.margem != null && (
                              <div>
                                <p className="text-xs text-muted-foreground">Margem</p>
                                <p className="text-sm font-medium">{cpe.margem.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} €/MWh</p>
                              </div>
                            )}
                            {cpe.comissao != null && (
                              <div>
                                <p className="text-xs text-muted-foreground">Comissão</p>
                                <p className="text-sm font-medium text-green-500">{formatCurrency(cpe.comissao)}</p>
                              </div>
                            )}
                          </div>
                          {(cpe.contrato_inicio || cpe.contrato_fim) && (
                            <div>
                              <p className="text-xs text-muted-foreground">Contrato</p>
                              <p className="text-sm">
                                {cpe.contrato_inicio ? format(new Date(cpe.contrato_inicio), "dd/MM/yyyy") : '—'}
                                {' → '}
                                {cpe.contrato_fim ? format(new Date(cpe.contrato_fim), "dd/MM/yyyy") : '—'}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Servicos Section (direct sale without proposal or servicos proposal) */}
                {(isNewFormat && catalog) && (!proposalId || proposalType === 'servicos') && (
                  <Card>
                    <CardContent className="p-4">
                      <ServicosSection
                        hideModeloServico
                        modeloServico={modeloServico || 'transacional'}
                        onModeloServicoChange={(v) => setModeloServico(v)}
                        servicosProdutos={servicosProdutos}
                        servicosDetails={servicosDetails}
                        isNewFormat={isNewFormat}
                        sellerUserId={sellerId ?? user?.id ?? null}
                        onSellerCommissionChange={setSellerCommissionTotal}
                        catalog={catalog}
                        operators={catalogOperators}
                        configs={servicosConfigs}
                        onToggleProduct={(name) => {
                          if (servicosProdutos.includes(name)) {
                            setServicosProdutos(prev => prev.filter(p => p !== name));
                            setServicosDetails(prev => {
                              const next = { ...prev };
                              delete next[name];
                              return next;
                            });
                          } else {
                            setServicosProdutos(prev => [...prev, name]);
                            const catProduct = catalog?.find(c => c.name === name);
                            if (catProduct) {
                              const comissaoVal = getCatalogCommission(catProduct);
                              setServicosDetails(prev => ({
                                ...prev,
                                [name]: {
                                  price: catProduct.price,
                                  commission_pct: catProduct.commission_pct,
                                  commission_type: catProduct.commission_type ?? 'pct',
                                  commission_fixed: catProduct.commission_fixed ?? 0,
                                  comissao: comissaoVal,
                                },
                              }));
                            }
                          }
                        }}
                        onUpdateDetail={() => {}}
                        onSetProductDetail={(product, detail) => {
                          setServicosDetails(prev => ({ ...prev, [product]: detail }));
                        }}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Products/Services */}
                {!isTelecom && (
                <Card>
                  <CardHeader className="pb-2 p-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <Package className="h-4 w-4" />
                      Produtos / Serviços
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-3">
                    <Select onValueChange={handleAddProduct}>
                      <SelectTrigger>
                        <SelectValue placeholder="Adicionar produto ou serviço..." />
                      </SelectTrigger>
                      <SelectContent>
                        {products?.filter(p => p.is_active).map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} - {formatCurrency(product.price || 0)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {items.length > 0 ? (
                      <div className="space-y-2">
                        {items.map((item) => {
                          const product = products?.find(p => p.id === item.product_id);
                          const isRecurring = product?.is_recurring;
                          
                          return (
                            <div 
                              key={item.id} 
                              className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-medium text-sm truncate">{item.name}</p>
                                    {ixActive && <VatBadge taxValue={vatCalc.getItemTaxRate(item.product_id)} />}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Button type="button" variant="outline" size="icon" className="h-6 w-6" onClick={() => handleUpdateQuantity(item.id, -0.5)}>
                                      <Minus className="h-3 w-3" />
                                    </Button>
                                    <span className="text-sm w-8 text-center">{item.quantity}</span>
                                    <Button type="button" variant="outline" size="icon" className="h-6 w-6" onClick={() => handleUpdateQuantity(item.id, 0.5)}>
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                    <span className="text-muted-foreground text-sm">×</span>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={item.unit_price}
                                      onChange={(e) => handleUpdatePrice(item.id, e.target.value)}
                                      disabled={isRecurring}
                                      title={isRecurring ? 'O preço recorrente vem do produto sincronizado com o Stripe.' : undefined}
                                      className="w-24 h-7 text-sm"
                                    />
                                    <span className="text-muted-foreground text-sm">€</span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="font-semibold">{formatCurrency(item.quantity * item.unit_price)}</p>
                                </div>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveItem(item.id)}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                              
                              {isRecurring && (
                                <div className="flex items-center gap-2 pl-2 text-sm border-t border-border/50 pt-2">
                                  <CalendarIcon className="h-4 w-4 text-primary" />
                                  <span className="text-muted-foreground">Vence em:</span>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
                                        {item.first_due_date ? format(item.first_due_date, "dd/MM/yyyy") : "Selecionar data"}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                      <Calendar
                                        mode="single"
                                        selected={item.first_due_date || undefined}
                                        onSelect={(date) => handleUpdateDueDate(item.id, date)}
                                        locale={pt}
                                        className="pointer-events-auto"
                                      />
                                    </PopoverContent>
                                  </Popover>
                                  <Badge variant="secondary" className="text-xs">
                                    <Zap className="h-3 w-3 mr-1" />
                                    Mensal
                                  </Badge>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border/50 rounded-lg">
                        Adicione produtos ou serviços à venda
                      </div>
                    )}
                  </CardContent>
                </Card>
                )}

                {!isTelecom && hasRecurringItems && (
                  <Card>
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        Faturação da recorrência
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-2">
                      <RecurringFiscalSettings
                        value={recurringFiscalConfig}
                        onChange={setRecurringFiscalConfig}
                        clientEmail={selectedClient?.email}
                        disabled={!canConfigureFiscal}
                        automaticDisabled={!keyInvoiceActive || hasRecurringRetention}
                        automaticDisabledReason={hasRecurringRetention
                          ? 'Produtos com retenção exigem emissão manual até à homologação deste cenário no KeyInvoice.'
                          : undefined}
                        compact
                      />
                      {!canConfigureFiscal && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Precisas da permissão Financeiro → Faturas → Emitir para configurar a emissão automática.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Payments (non-telecom) */}
                {!isTelecom && (
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center justify-between text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4" />
                          Pagamentos
                        </div>
                        {grossValue > 0 && (() => {
                          const summary = calculatePaymentSummary(
                            draftPayments.map(dp => ({ ...dp, id: dp.id, organization_id: '', sale_id: '', invoice_file_url: null, created_at: '', updated_at: '' })),
                            grossValue
                          );
                          return summary.remaining > 0;
                        })() && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowPaymentTypeSelector(true)}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Adicionar
                          </Button>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      {draftPayments.length > 0 ? (
                        <div className="space-y-2">
                          {draftPayments.map((dp) => (
                            <div
                              key={dp.id}
                              className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/30"
                            >
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm">{formatCurrency(dp.amount)}</span>
                                  <StatusBadge {...paymentRecordStatusBadge(dp.status)} />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {dp.payment_date}
                                  {dp.payment_method && ` • ${PAYMENT_METHOD_LABELS[dp.payment_method]}`}
                                  {dp.invoice_reference && ` • ${dp.invoice_reference}`}
                                </span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setDraftPayments(prev => prev.filter(p => p.id !== dp.id))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}

                          {(() => {
                            const summary = calculatePaymentSummary(
                              draftPayments.map(dp => ({ ...dp, organization_id: '', sale_id: '', invoice_file_url: null, created_at: '', updated_at: '' })),
                              grossValue
                            );
                            return (
                              <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-2">
                                <div className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">Total pago</span>
                                  <span className="font-medium text-green-500">{formatCurrency(summary.totalPaid)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">Em falta</span>
                                  <span className="font-medium">{formatCurrency(summary.remaining)}</span>
                                </div>
                                <Progress value={summary.percentage} className="h-2" />
                              </div>
                            );
                          })()}
                        </div>
                      ) : grossValue > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full border-dashed"
                          onClick={() => setShowPaymentTypeSelector(true)}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Adicionar Pagamento
                        </Button>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          Adicione produtos para registar pagamentos
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* RIGHT COLUMN (40%) - Sticky summary */}
              <div className="lg:col-span-2">
                <div className="lg:sticky lg:top-6 space-y-4">
                  {/* Summary Card */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        Resumo
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{isTelecom ? 'Comissão' : 'Subtotal'}</span>
                        <span className="font-medium">
                          {formatCurrency(isTelecom ? sellerCommissionTotal : subtotal)}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm text-muted-foreground">Desconto</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">-</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={discount}
                            onChange={(e) => setDiscount(e.target.value)}
                            className="w-24 h-8 text-sm"
                          />
                          <span className="text-muted-foreground text-sm">€</span>
                        </div>
                      </div>
                      {hasRecurringItems && discountValue > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Este desconto fica no registo inicial. A mensalidade recorrente mantém o valor bruto dos produtos sincronizados com o Stripe.
                        </p>
                      )}

                      <Separator />

                      {ixActive && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">IVA</span>
                          <span className="font-medium">{formatCurrency(vatCalc.totalVat)}</span>
                        </div>
                      )}

                      <div className="flex justify-between">
                        <span className="font-semibold">
                          {isTelecom ? 'Comissão' : ixActive ? 'Total (s/ IVA)' : 'Total'}
                        </span>
                        <span className="text-xl font-bold text-primary">
                          {formatCurrency(isTelecom ? sellerCommissionTotal : ixActive ? vatCalc.totalWithoutVat : total)}
                        </span>
                      </div>

                      {ixActive && (
                        <div className="flex justify-between text-sm border-t pt-2">
                          <span className="text-muted-foreground font-medium">Total c/ IVA</span>
                          <span className="font-semibold">{formatCurrency(vatCalc.totalWithVat)}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Operator proposal number — named after the operator this
                      sale is actually under, and hidden entirely when it has
                      none (no operator, no operator proposal number). */}
                  {saleFields?.edp_proposal_number?.visible && saleOperatorNames.length > 0 && (<Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {/* Never required: a sale can be closed before the
                            operator has issued a proposal number. */}
                        {saleOperatorNames.length === 1
                          ? `Número Proposta ${saleOperatorNames[0]}`
                          : 'Número de Proposta'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <Input
                        placeholder={saleOperatorNames.length === 1
                          ? `Nº da proposta na ${saleOperatorNames[0]}`
                          : 'Nº da proposta na operadora'}
                        value={edpProposalNumber}
                        onChange={(e) => setEdpProposalNumber(e.target.value)}
                      />
                    </CardContent>
                  </Card>)}

                  {/* Notes */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Notas</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <Textarea
                        placeholder="Observações sobre a venda..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        className="min-h-[60px]"
                      />
                    </CardContent>
                  </Card>

                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="p-4 border-t border-border/50 shrink-0">
          <div className="flex gap-3 max-w-6xl mx-auto">
            <Button
              variant="senvia"
              className="flex-1"
              size="lg"
              onClick={handleSubmit}
              disabled={createSale.isPending}
            >
              {createSale.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  A criar...
                </>
              ) : (
                "Criar Venda"
              )}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              size="lg"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>

        {/* Payment Type Selector */}
        <PaymentTypeSelector
          open={showPaymentTypeSelector}
          onOpenChange={setShowPaymentTypeSelector}
          remainingAmount={(() => {
            const summary = calculatePaymentSummary(
              draftPayments.map(dp => ({ ...dp, organization_id: '', sale_id: '', invoice_file_url: null, created_at: '', updated_at: '' })),
              grossValue
            );
            return summary.remaining;
          })()}
          onSelectTotal={() => {
            setShowPaymentTypeSelector(false);
            setShowDraftPaymentModal(true);
          }}
          onSelectInstallments={() => {
            setShowPaymentTypeSelector(false);
            setShowDraftScheduleModal(true);
          }}
        />

        {/* Draft Payment Modal */}
        <AddDraftPaymentModal
          open={showDraftPaymentModal}
          onOpenChange={(open) => {
            setShowDraftPaymentModal(open);
            if (!open) {}
          }}
          saleTotal={grossValue}
          remaining={(() => {
            const summary = calculatePaymentSummary(
              draftPayments.map(dp => ({ ...dp, organization_id: '', sale_id: '', invoice_file_url: null, created_at: '', updated_at: '' })),
              grossValue
            );
            return summary.remaining;
          })()}
          onAdd={(payment) => setDraftPayments(prev => [...prev, payment])}
          hideInvoiceReference={ixActive}
          
        />

        {/* Draft Schedule Modal */}
        <DraftScheduleModal
          open={showDraftScheduleModal}
          onOpenChange={setShowDraftScheduleModal}
          remainingAmount={(() => {
            const summary = calculatePaymentSummary(
              draftPayments.map(dp => ({ ...dp, organization_id: '', sale_id: '', invoice_file_url: null, created_at: '', updated_at: '' })),
              grossValue
            );
            return summary.remaining;
          })()}
          onAdd={(payments) => setDraftPayments(prev => [...prev, ...payments])}
        />
      </DialogContent>
    </Dialog>
  );
}
