import { useState, useEffect, useMemo, useRef } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/searchable-combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useClients } from "@/hooks/useClients";
import { useProducts } from "@/hooks/useProducts";
import { useUpdateSale } from "@/hooks/useSales";
import { useSaleItems, useCreateSaleItems, useUpdateSaleItem, useDeleteSaleItem } from "@/hooks/useSaleItems";
import { useCreateSalePayment, useSalePayments, calculatePaymentSummary } from "@/hooks/useSalePayments";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useOrganization } from "@/hooks/useOrganization";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useModules } from "@/hooks/useModules";
import { format } from "date-fns";
import { BillingRecipientSelector, ClientFiscalCard, VatBadge, useVatCalculation, isInvoiceXpressActive, getOrgTaxValue } from "./SaleFiscalInfo";
import type { BillingTarget } from "@/types/clients";
import { supabase } from "@/integrations/supabase/client";
import { pt } from "date-fns/locale";
import { StatusBadge } from "@/components/ui/status-badge";
import { saleStatusBadge } from "@/lib/status-badge-maps";
import { toast } from "sonner";
import { 
  Loader2, 
  CalendarIcon, 
  Plus, 
  Minus, 
  X, 
  Package, 
  User,
  FileText,
  AlertCircle,
  RefreshCw,
  CreditCard,
  Zap,
  Wrench,
} from "lucide-react";

import type { SaleWithDetails, TelecomStatus } from "@/types/sales";
import { TELECOM_STATUSES, TELECOM_STATUS_LABELS, TELECOM_STATUS_HINTS, TELECOM_TO_SALE_STATUS } from "@/types/sales";

/** Radix Select can't hold an empty string as a value. */
const NO_TELECOM_STATUS = "__none__";
import { SalePaymentsList } from "./SalePaymentsList";
import { RecurringSalePanel } from "./RecurringSalePanel";
import { Progress } from "@/components/ui/progress";
import { useProposalCpes, useUpdateProposalCpes } from "@/hooks/useProposalCpes";
import type { CreateProposalCpeData } from "@/hooks/useProposalCpes";
import { useCpes } from "@/hooks/useCpes";
import { NEGOTIATION_TYPE_LABELS, NEGOTIATION_TYPES, MODELO_SERVICO_LABELS, getCatalogCommission, productNeedsTechnologyChoice, productTechnologies } from "@/types/proposals";
import type { ServicosDetails } from "@/types/proposals";
import { useServicosProducts } from '@/hooks/useServicosProducts';
import { ServicosSection } from '@/components/proposals/ServicosSection';
import { SellerSelect } from '@/components/sales/SellerSelect';
import { DocumentsCheckboxField, ContractSignedCheckboxField } from '@/components/shared/DocumentsCheckboxField';
import { useCommissionMatrix, getVolumeTier } from "@/hooks/useCommissionMatrix";
import type { NegotiationType, ModeloServico } from "@/types/proposals";
import { Checkbox } from "@/components/ui/checkbox";
import { CPE_STATUS_LABELS, CPE_STATUS_STYLES } from "@/types/cpes";
import { useSaleFieldsSettings } from "@/hooks/useSaleFieldsSettings";
import { normalizeOperationalUnits } from "@/lib/sale-units";

interface SaleItemDraft {
  id: string;
  originalId?: string;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  first_due_date?: Date | null;
  isNew?: boolean;
  isModified?: boolean;
}

interface EditSaleModalProps {
  sale: SaleWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function EditSaleModal({ 
  sale, 
  open, 
  onOpenChange, 
  onSuccess
}: EditSaleModalProps) {
  const { data: clients } = useClients();
  const { products: catalogProductNames, configs: SERVICOS_PRODUCT_CONFIGS, catalog, isNewFormat, operators: catalogOperators } = useServicosProducts();
  const { data: products } = useProducts();
  const { data: existingItems = [] } = useSaleItems(sale?.id);
  
  const updateSale = useUpdateSale();
  const createSaleItems = useCreateSaleItems();
  const updateSaleItem = useUpdateSaleItem();
  const deleteSaleItem = useDeleteSaleItem();
  const createSalePayment = useCreateSalePayment();

  const { organization } = useAuth();
  const { isAdmin } = usePermissions();
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  const { data: saleFields } = useSaleFieldsSettings();
  const { calculateCommission, isAutoCalculated, calculateEnergyCommission, hasEnergyConfig } = useCommissionMatrix();
  const { data: orgData } = useOrganization();
  const salesSettings = (orgData?.sales_settings as { lock_delivered_sales?: boolean }) || {};
  const isDeliveredLocked = !!salesSettings.lock_delivered_sales && sale?.status === 'delivered' && !isAdmin;
  
  // Proposal CPEs and client CPEs
  const { data: proposalCpes = [] } = useProposalCpes(sale?.proposal_id ?? undefined);
  const updateProposalCpes = useUpdateProposalCpes();
  const clientIdForCpes = sale?.client_id || sale?.client?.id || null;
  const { data: clientCpes = [] } = useCpes(clientIdForCpes);
  const cpeLabel = isTelecom ? 'CPE/CUI (Pontos de Consumo)' : 'CPEs (Equipamentos)';
  const serialLabel = isTelecom ? 'Local de Consumo' : 'Nº Série';

  // Fiscal info
  const ixActive = isInvoiceXpressActive(organization);
  const orgTaxValue = getOrgTaxValue(organization);

  // Payment progress
  const { data: salePayments = [] } = useSalePayments(sale?.id);
  const paymentSummary = calculatePaymentSummary(
    salePayments,
    sale ? (sale.gross_value ?? sale.total_value) : 0,
  );
  
  // Form state
  const [clientId, setClientId] = useState<string>("");
  const [billingTarget, setBillingTarget] = useState<BillingTarget>('client');
  
  const [items, setItems] = useState<SaleItemDraft[]>([]);
  const [originalItemIds, setOriginalItemIds] = useState<string[]>([]);
  const [discount, setDiscount] = useState<string>("0");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Energy/Service editable state
  const [negotiationType, setNegotiationType] = useState<string>("");
  const [consumoAnual, setConsumoAnual] = useState<string>("");
  const [margem, setMargem] = useState<string>("");
  const [dbl, setDbl] = useState<string>("");
  const [anosContrato, setAnosContrato] = useState<string>("");
  const [fidelizacaoEnd, setFidelizacaoEnd] = useState<string>("");
  const [comissao, setComissao] = useState<string>("");
  const [modeloServico, setModeloServico] = useState<string>("");
  const [kwp, setKwp] = useState<string>("");
  const [servicosProdutos, setServicosProdutos] = useState<string[]>([]);
  const [servicosDetails, setServicosDetails] = useState<ServicosDetails>({});

  // Manual total value (for sales without items)
  const [manualTotalValue, setManualTotalValue] = useState<string>("");
  // What this sale pays the person it is assigned to, reported up by
  // ServicosSection. In telecom this — not total_value — is the number the
  // summary shows: the client pays the operator, so the sale's own value is
  // not money anyone in this org ever sees.
  const [sellerCommissionTotal, setSellerCommissionTotal] = useState(0);
  const [activationDate, setActivationDate] = useState<string>("");
  const [telecomStatus, setTelecomStatus] = useState<TelecomStatus | "">("");
  // Reassigning the sale: null keeps it with whoever created it.
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [scheduledInstallDate, setScheduledInstallDate] = useState<string>("");
  const [scheduledInstallTime, setScheduledInstallTime] = useState<string>("");
  const [scheduledInstallEndTime, setScheduledInstallEndTime] = useState<string>("");
  const [documentsChecked, setDocumentsChecked] = useState(false);
  const [contractSigned, setContractSigned] = useState(false);
  const [edpProposalNumber, setEdpProposalNumber] = useState<string>("");

  // Which operator(s) this sale is actually under — from the frozen operator
  // on each product line, falling back to the catalog for lines added before
  // that was recorded. Drives the proposal-number field: there is no "EDP
  // number" unless the sale is an EDP one.
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

  // Editable CPEs state
  const [editableCpes, setEditableCpes] = useState<CreateProposalCpeData[]>([]);

  // Initialize form with sale data
  useEffect(() => {
    if (open && sale) {
      setClientId(sale.client_id || "");
      setBillingTarget(sale.billing_target === 'company' || (!sale.billing_target && sale.client?.billing_target === 'company') ? 'company' : 'client');
      setDiscount(sale.discount?.toString() || "0");
      setNotes(sale.notes || "");
      // Energy/Service fields
      setNegotiationType(sale.negotiation_type || "");
      setConsumoAnual(sale.consumo_anual?.toString() || "");
      setMargem(sale.margem?.toString() || "");
      setDbl(sale.dbl?.toString() || "");
      setAnosContrato(sale.anos_contrato?.toString() || "");
      setComissao(sale.comissao?.toString() || "");
      setModeloServico(sale.modelo_servico || "");
      setKwp(sale.kwp?.toString() || "");
      setServicosProdutos(sale.servicos_produtos || []);
      setServicosDetails((sale as any).servicos_details || {});
      setManualTotalValue(sale.total_value?.toString() || "0");
      setActivationDate(sale.activation_date || "");
      setFidelizacaoEnd((sale as any).fidelizacao_end || "");
      setTelecomStatus((sale.telecom_status as TelecomStatus) || "");
      // Show the sale's real owner — the person it was created by, unless it
      // was explicitly reassigned. Blank here would look broken and defaulting
      // it to whichever admin opens the sale would misattribute it silently.
      setSellerId(sale.seller_id ?? sale.created_by ?? null);
      // scheduled_install_date is a timestamptz — split it for the separate
      // date and time inputs (a native <input type="date"> rejects anything
      // but yyyy-MM-dd).
      if (sale.scheduled_install_date) {
        const [datePart, timePart] = sale.scheduled_install_date.split('T');
        setScheduledInstallDate(datePart || "");
        setScheduledInstallTime(timePart ? timePart.slice(0, 5) : "");
      } else {
        setScheduledInstallDate("");
        setScheduledInstallTime("");
      }
      setScheduledInstallEndTime(
        sale.scheduled_install_end ? (sale.scheduled_install_end.split('T')[1] ?? "").slice(0, 5) : "",
      );
      setDocumentsChecked(!!sale.documents_checked);
      setContractSigned(!!sale.contract_signed);
      setEdpProposalNumber((sale as any).edp_proposal_number || "");
    }
  }, [open, sale]);

  // Keep stable refs for commission calculation to avoid re-triggering init
  const calcCommissionRef = useRef(calculateEnergyCommission);
  const hasEnergyConfigRef = useRef(hasEnergyConfig);
  calcCommissionRef.current = calculateEnergyCommission;
  hasEnergyConfigRef.current = hasEnergyConfig;

  // Initialize editable CPEs from proposalCpes with recalculated commissions
  useEffect(() => {
    if (open && proposalCpes.length > 0) {
      setEditableCpes(proposalCpes.map(cpe => {
        // Recalculate commission using current tier rules
        let comissao = cpe.comissao;
        if (hasEnergyConfigRef.current && cpe.margem && cpe.consumo_anual) {
          const margem = Number(cpe.margem);
          if (margem > 0) {
            const calc = calcCommissionRef.current(margem, getVolumeTier(Number(cpe.consumo_anual) || 0));
            if (calc !== null) comissao = calc;
          }
        }
        return {
          proposal_id: cpe.proposal_id,
          existing_cpe_id: cpe.existing_cpe_id,
          equipment_type: cpe.equipment_type,
          serial_number: cpe.serial_number,
          comercializador: cpe.comercializador,
          fidelizacao_start: cpe.fidelizacao_start,
          fidelizacao_end: cpe.fidelizacao_end,
          notes: cpe.notes,
          consumo_anual: cpe.consumo_anual,
          duracao_contrato: cpe.duracao_contrato,
          dbl: cpe.dbl,
          margem: cpe.margem,
          comissao,
          contrato_inicio: cpe.contrato_inicio,
          contrato_fim: cpe.contrato_fim,
        };
      }));
    } else if (open) {
      setEditableCpes([]);
    }
  }, [open, proposalCpes]);

  // Initialize items when existingItems load
  useEffect(() => {
    if (open && existingItems.length > 0) {
      const draftItems: SaleItemDraft[] = existingItems.map(item => ({
        id: crypto.randomUUID(),
        originalId: item.id,
        product_id: item.product_id,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        first_due_date: (item as any).first_due_date ? new Date((item as any).first_due_date) : null,
        isNew: false,
        isModified: false,
      }));
      setItems(draftItems);
      setOriginalItemIds(existingItems.map(i => i.id));
    } else if (open && existingItems.length === 0) {
      setItems([]);
      setOriginalItemIds([]);
    }
  }, [open, existingItems]);

  // Sync manualTotalValue when editable CPEs change (telecom energia sales).
  //
  // The 'servicos' branch used to do `setManualTotalValue(comissao)`, which
  // meant every save overwrote the sale's own value with its commission: a
  // 53,50 € contract was stored as a 210 € sale. It hit all ten telecom sales
  // in this org. The commission is not the sale's value — it is what the
  // operator pays us for it, it is already stored in sales.comissao, and it
  // moves whenever the catalog changes. Showing it is a job for the screen
  // (see SaleDetailsModal), never for the stored figure.
  useEffect(() => {
    if (!open || !sale || !isTelecom) return;
    if (sale.proposal_type === 'energia' && editableCpes.length > 0) {
      const margemTotal = editableCpes.reduce((sum, cpe) => sum + (cpe.margem || 0), 0);
      setManualTotalValue(margemTotal.toString());
    }
  }, [open, sale, isTelecom, editableCpes]);

  // Auto-recalculate commission when relevant fields change (servicos only)
  useEffect(() => {
    if (!open || sale?.proposal_type !== 'servicos' || servicosProdutos.length === 0) return;
    
    let total = 0;
    let anyCalc = false;
    const kwpVal = parseFloat(kwp) || undefined;
    const valorVal = parseFloat(manualTotalValue) || undefined;
    const ms = (modeloServico as 'transacional' | 'saas') || undefined;
    
    for (const prodName of servicosProdutos) {
      const detail = { kwp: kwpVal, valor: valorVal };
      const calc = calculateCommission(prodName, detail, ms);
      if (calc !== null) {
        total += Math.round(calc * 100) / 100;
        anyCalc = true;
      }
    }
    
    if (anyCalc) {
      setComissao(total.toString());
    }
  }, [open, sale?.proposal_type, servicosProdutos, kwp, modeloServico, manualTotalValue, calculateCommission]);

  // Check if sale can be fully edited
  const canFullEdit = isAdmin || (sale?.status !== 'delivered' && sale?.status !== 'cancelled' && sale?.status !== 'fulfilled');

  // Client options
  const clientOptions: ComboboxOption[] = useMemo(() => {
    if (!clients) return [];
    return clients.map(c => ({
      value: c.id,
      label: c.name,
      subtitle: c.code || c.email || undefined,
    }));
  }, [clients]);

  // Product options
  const productOptions: ComboboxOption[] = useMemo(() => {
    if (!products) return [];
    const existingProductIds = items.map(i => i.product_id).filter(Boolean);
    return products
      .filter(p => p.is_active && !existingProductIds.includes(p.id))
      .map(p => ({
        value: p.id,
        label: p.name,
        subtitle: p.price ? formatCurrency(p.price) : undefined,
      }));
  }, [products, items]);

  // Calculate totals
  const hasItems = items.length > 0;
  const itemsSubtotal = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  }, [items]);

  const enteredSubtotal = hasItems ? itemsSubtotal : parseFloat(manualTotalValue) || 0;
  const discountValue = parseFloat(discount) || 0;

  // VAT calculation
  const vatCalc = useVatCalculation({
    items, products, orgTaxValue, discount: discountValue, subtotal: enteredSubtotal,
  });
  const subtotal = isTelecom || !hasItems ? enteredSubtotal : vatCalc.subtotalWithoutVat;
  const total = isTelecom || !hasItems
    ? Math.max(0, enteredSubtotal - (hasItems ? discountValue : 0))
    : vatCalc.totalWithoutVat;
  const grossValue = isTelecom || !hasItems ? total : vatCalc.totalWithVat;

  // Selected client fiscal data
  const selectedClient = useMemo(() => {
    if (!clientId || !clients) return null;
    return clients.find(c => c.id === clientId) || null;
  }, [clientId, clients]);

  // Handlers
  const handleAddProduct = (productId: string) => {
    const product = products?.find(p => p.id === productId);
    if (!product) return;

    const existing = items.find(i => i.product_id === productId);
    if (existing) {
      setItems(items.map(i => 
        i.product_id === productId 
          ? { ...i, quantity: i.quantity + 1, isModified: !i.isNew }
          : i
      ));
    } else {
      setItems([...items, {
        id: crypto.randomUUID(),
        product_id: product.id,
        name: product.name,
        quantity: 1,
        unit_price: product.price || 0,
        isNew: true,
      }]);
    }
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setItems(items.map(i => {
      if (i.id === itemId) {
        const newQty = normalizeOperationalUnits(i.quantity + delta);
        return { ...i, quantity: newQty, isModified: !i.isNew };
      }
      return i;
    }));
  };

  const handleUpdatePrice = (itemId: string, price: string) => {
    setItems(items.map(i => {
      if (i.id === itemId) {
        return { ...i, unit_price: parseFloat(price) || 0, isModified: !i.isNew };
      }
      return i;
    }));
  };

  const handleUpdateName = (itemId: string, name: string) => {
    setItems(items.map(i => {
      if (i.id === itemId) {
        return { ...i, name, isModified: !i.isNew };
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
        ? { ...i, first_due_date: date || null, isModified: !i.isNew }
        : i
    ));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sale) return;

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
    for (const cpe of editableCpes) {
      if (cpe.contrato_inicio && cpe.contrato_fim && cpe.contrato_inicio > cpe.contrato_fim) {
        toast.error(`CPE ${cpe.serial_number || ""}: o início do contrato é depois do fim.`);
        return;
      }
    }
    if (isTelecom && activationDate) {
      const fims = editableCpes.map((c) => c.contrato_fim).filter(Boolean) as string[];
      if (fims.length > 0 && activationDate > fims.reduce((a, b) => (a > b ? a : b))) {
        toast.error("A data de ativação é posterior ao fim do contrato.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      await updateSale.mutateAsync({
        saleId: sale.id,
        updates: {
          client_id: clientId || null,
          ...(!sale.invoicexpress_id && !sale.invoice_reference ? { billing_target: billingTarget } : {}),
          seller_id: sellerId,
          total_value: total,
          gross_value: grossValue,
          subtotal: subtotal,
          discount: discountValue,
          notes: notes.trim() || null,
          negotiation_type: negotiationType || null,
          consumo_anual: parseFloat(consumoAnual) || null,
          margem: parseFloat(margem) || null,
          dbl: parseFloat(dbl) || null,
          anos_contrato: parseInt(anosContrato) || null,
          comissao: parseFloat(comissao) || null,
          modelo_servico: (modeloServico as ModeloServico) || null,
          kwp: parseFloat(kwp) || null,
          servicos_produtos: servicosProdutos.length > 0 ? servicosProdutos : null,
          servicos_details: Object.keys(servicosDetails).length > 0 ? servicosDetails : null,
          ...(isTelecom ? {
            activation_date: activationDate || ((telecomStatus === 'ativo' || telecomStatus === 'instalado') && scheduledInstallDate ? scheduledInstallDate : null),
            telecom_status: telecomStatus || null,
            scheduled_install_date: scheduledInstallDate
              ? `${scheduledInstallDate}T${scheduledInstallTime || '00:00'}:00`
              : null,
            scheduled_install_end: scheduledInstallDate && scheduledInstallEndTime
              ? `${scheduledInstallDate}T${scheduledInstallEndTime}:00`
              : null,
            documents_checked: documentsChecked,
            fidelizacao_end: fidelizacaoEnd || null,
            contract_signed: contractSigned,
            // The telecom state IS the sale state here; sales.status is kept
            // in sync behind it so invoicing/finance keep matching on it.
            ...(telecomStatus ? { status: TELECOM_TO_SALE_STATUS[telecomStatus] } : {}),
          } : {}),
          ...(showEnergy && saleFields?.edp_proposal_number?.visible ? { edp_proposal_number: edpProposalNumber.trim() || null } : {}),
        },
      });

      // Save CPE changes if proposal exists
      if (sale.proposal_id && editableCpes.length > 0) {
        await updateProposalCpes.mutateAsync({
          proposalId: sale.proposal_id,
          cpes: editableCpes,
        });
      }

      const currentItemOriginalIds = items
        .filter(i => i.originalId)
        .map(i => i.originalId!);
      
      const itemsToDelete = originalItemIds.filter(
        id => !currentItemOriginalIds.includes(id)
      );
      const itemsToUpdate = items.filter(i => i.originalId && i.isModified);
      const itemsToCreate = items.filter(i => i.isNew);

      await Promise.all(
        itemsToDelete.map(id => 
          deleteSaleItem.mutateAsync({ itemId: id, saleId: sale.id })
        )
      );

      await Promise.all(
        itemsToUpdate.map(item => 
          updateSaleItem.mutateAsync({
            itemId: item.originalId!,
            saleId: sale.id,
            updates: {
              name: item.name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              total: item.quantity * item.unit_price,
              first_due_date: item.first_due_date 
                ? format(item.first_due_date, 'yyyy-MM-dd') 
                : null,
            },
          })
        )
      );

      if (itemsToCreate.length > 0) {
        await createSaleItems.mutateAsync(
          itemsToCreate.map(item => ({
            sale_id: sale.id,
            product_id: item.product_id,
            name: item.name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.quantity * item.unit_price,
            first_due_date: item.first_due_date 
              ? format(item.first_due_date, 'yyyy-MM-dd') 
              : null,
          }))
        );
        
        if (organization && sale.status === 'delivered') {
          const recurringNewItemsWithDate = itemsToCreate.filter(item => {
            if (!item.product_id) return false;
            const product = products?.find(p => p.id === item.product_id);
            return product?.is_recurring && item.first_due_date;
          });
          
          for (const item of recurringNewItemsWithDate) {
            await createSalePayment.mutateAsync({
              sale_id: sale.id,
              organization_id: organization.id,
              amount: item.quantity * item.unit_price,
              payment_date: format(item.first_due_date!, 'yyyy-MM-dd'),
              status: 'pending',
              notes: `Mensalidade: ${item.name}`,
            });
          }
        }
      }

      if (organization && sale.status === 'delivered') {
        for (const item of items) {
          if (item.originalId && !item.isNew) {
            const product = products?.find(p => p.id === item.product_id);
            if (product?.is_recurring && item.first_due_date) {
              const paymentDateStr = format(item.first_due_date, 'yyyy-MM-dd');
              
              // Check for ANY existing payment on this date (paid or pending).
              // Filtering by status === 'pending' here caused a duplicate to be
              // generated when a sale value was edited after the installment had
              // already been paid: the paid row was not found, so a new pending
              // row was created at the new price on the old date.
              const { data: existingPayments } = await supabase
                .from('sale_payments')
                .select('id')
                .eq('sale_id', sale.id)
                .eq('payment_date', paymentDateStr);

              if (!existingPayments || existingPayments.length === 0) {
                await createSalePayment.mutateAsync({
                  sale_id: sale.id,
                  organization_id: organization.id,
                  amount: item.quantity * item.unit_price,
                  payment_date: paymentDateStr,
                  status: 'pending',
                  notes: `Mensalidade: ${item.name}`,
                });
              }
            }
          }
        }
      }

      toast.success("Venda atualizada com sucesso!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Error updating sale:", error);
      toast.error("Erro ao atualizar venda");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!sale) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
        <DialogHeader className="pl-6 pr-14 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Editar Venda
            {sale.code && (
              <Badge variant="outline" className="font-mono text-xs">
                {sale.code}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto p-4 sm:p-6">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* LEFT COLUMN (60%) */}
                <div className="lg:col-span-3 space-y-4">
                  {/* Dados da Venda */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        Dados da Venda
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Código</Label>
                          <p className="font-mono text-sm font-medium">{sale.code || '—'}</p>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Data da Venda</Label>
                          <p className="text-sm font-medium">
                            {format(new Date(sale.sale_date), "d MMM yyyy", { locale: pt })}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Estado</Label>
                          {/* One lifecycle in telecom, not two: this writes
                              sales.status behind it (TELECOM_TO_SALE_STATUS). */}
                          {isTelecom ? (
                            <Select
                              value={telecomStatus || NO_TELECOM_STATUS}
                              onValueChange={(v) => setTelecomStatus(v === NO_TELECOM_STATUS ? '' : v as TelecomStatus)}
                              disabled={isDeliveredLocked}
                            >
                              <SelectTrigger className="h-9"><SelectValue placeholder="Sem estado" /></SelectTrigger>
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
                            <div>
                              <StatusBadge {...saleStatusBadge(sale.status)} />
                            </div>
                          )}
                        </div>

                        {/* Reassigning moves the commission to the new seller. */}
                        <SellerSelect
                          className="space-y-1.5"
                          value={sellerId}
                          onChange={setSellerId}
                        />

                        {/* No activation field: the install date is the activation
                            once the sale is live (see the save payload). */}
                        {isTelecom && (
                          <>
                            {/* Full row: the date plus its "das X às Y" window
                                never fits one third of the grid. */}
                            <div className="space-y-1.5 col-span-1 sm:col-span-3">
                              <Label className="text-xs text-muted-foreground">Data de Instalação</Label>
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  type="date"
                                  value={scheduledInstallDate}
                                  onChange={(e) => setScheduledInstallDate(e.target.value)}
                                  className="h-9 w-auto"
                                  disabled={isDeliveredLocked}
                                />
                                {/* Booked as a window ("das 9h às 12h"). */}
                                {scheduledInstallDate && (
                                  <>
                                    <span className="text-xs text-muted-foreground shrink-0">das</span>
                                    <Input
                                      type="time"
                                      value={scheduledInstallTime}
                                      onChange={(e) => setScheduledInstallTime(e.target.value)}
                                      className="h-9 w-auto"
                                      disabled={isDeliveredLocked}
                                    />
                                    <span className="text-xs text-muted-foreground shrink-0">às</span>
                                    <Input
                                      type="time"
                                      value={scheduledInstallEndTime}
                                      onChange={(e) => setScheduledInstallEndTime(e.target.value)}
                                      className="h-9 w-auto"
                                      disabled={isDeliveredLocked}
                                    />
                                  </>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground">Opcional — sem data conta como "sem data marcada".</p>
                            </div>

                            <div className="col-span-1 sm:col-span-3 space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Fim da fidelização</Label>
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  type="date"
                                  value={fidelizacaoEnd}
                                  onChange={(e) => setFidelizacaoEnd(e.target.value)}
                                  className="h-9 w-auto"
                                  disabled={isDeliveredLocked}
                                />
                                {(activationDate || scheduledInstallDate) && !fidelizacaoEnd && !isDeliveredLocked && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-9 text-xs"
                                    onClick={() => {
                                      const base = new Date(activationDate || scheduledInstallDate);
                                      base.setFullYear(base.getFullYear() + 2);
                                      setFidelizacaoEnd(format(base, "yyyy-MM-dd"));
                                    }}
                                  >
                                    +2 anos
                                  </Button>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground">Os alertas de renovação (push e email aos admins) partem desta data.</p>
                            </div>

                            <div className="col-span-1 sm:col-span-3 flex flex-wrap items-center gap-x-8 gap-y-2 pt-1">
                              <DocumentsCheckboxField
                                id="edit-sale-documents"
                                checked={documentsChecked}
                                onChange={setDocumentsChecked}
                              />
                              <ContractSignedCheckboxField
                                id="edit-sale-contract"
                                checked={contractSigned}
                                onChange={setContractSigned}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Client */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <User className="h-4 w-4" />
                        Informação Básica
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-4">
                      <div className="space-y-2">
                        <Label>Cliente</Label>
                        <SearchableCombobox
                          options={clientOptions}
                          value={clientId}
                          onValueChange={(id) => {
                            setClientId(id);
                            const nextClient = clients?.find(client => client.id === id);
                            setBillingTarget(nextClient?.billing_target === 'company' ? 'company' : 'client');
                          }}
                          placeholder="Selecionar cliente..."
                          searchPlaceholder="Pesquisar cliente..."
                          emptyText="Nenhum cliente encontrado"
                          disabled={!canFullEdit}
                        />
                      </div>

                      {/* Client Fiscal Card */}
                      {clientId && (
                        <div className="space-y-3">
                          <BillingRecipientSelector
                            client={selectedClient}
                            value={billingTarget}
                            onChange={setBillingTarget}
                            disabled={isDeliveredLocked || sale.status === 'cancelled' || !!sale.invoicexpress_id || !!sale.invoice_reference}
                          />
                          <ClientFiscalCard client={selectedClient} billingTarget={billingTarget} isInvoiceXpressActive={ixActive} />
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Proposal info (read-only) */}
                  {sale.proposal && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Proposta associada:</span>
                          {sale.proposal.code && (
                            <Badge variant="outline" className="font-mono text-xs">
                              {sale.proposal.code}
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Energy Data (editable) */}
                  {showEnergy && sale?.proposal_type === 'energia' && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Zap className="h-4 w-4 text-amber-500" />
                          Dados de Energia
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Tipo de Negociação</Label>
                            <Select value={negotiationType} onValueChange={setNegotiationType}>
                              <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                              <SelectContent>
                                {NEGOTIATION_TYPES.map(t => (<SelectItem key={t} value={t}>{NEGOTIATION_TYPE_LABELS[t]}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Consumo Anual (kWh)</Label>
                            <Input type="number" value={consumoAnual} onChange={e => setConsumoAnual(e.target.value)} className="h-9" step="0.01" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Margem (€/MWh)</Label>
                            <Input type="number" value={margem} onChange={e => setMargem(e.target.value)} className="h-9" step="0.01" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Anos de Contrato (auto)</Label>
                            <Input type="number" value={anosContrato} className="h-9 bg-muted" step="1" min="0" disabled />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">DBL</Label>
                            <Input type="number" value={dbl} onChange={e => setDbl(e.target.value)} className="h-9" step="0.01" />
                          </div>
                          <div className="col-span-2 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Comissão (€)</Label>
                            <Input type="number" value={comissao} onChange={e => setComissao(e.target.value)} className="h-9" step="0.01" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Service Data (editable) - new catalog format */}
                  {isTelecom && isNewFormat && catalog && (sale?.proposal_type === 'servicos' || !sale?.proposal_type) && (
                    <Card>
                      <CardContent className="p-4">
                        <ServicosSection
                          hideModeloServico
                          modeloServico={(modeloServico as 'transacional' | 'saas') || 'transacional'}
                          onModeloServicoChange={(v) => setModeloServico(v)}
                          servicosProdutos={servicosProdutos}
                          servicosDetails={servicosDetails}
                          isNewFormat={isNewFormat}
                          catalog={catalog}
                          operators={catalogOperators}
                          sellerUserId={sellerId ?? sale.created_by}
                          onSellerCommissionChange={setSellerCommissionTotal}
                          configs={SERVICOS_PRODUCT_CONFIGS}
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

                  {/* Service Data (editable) - legacy format */}
                  {isTelecom && !isNewFormat && sale?.proposal_type === 'servicos' && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Wrench className="h-4 w-4 text-blue-500" />
                          Dados do Serviço
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Tipo de Negociação</Label>
                            <Select value={negotiationType} onValueChange={setNegotiationType}>
                              <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                              <SelectContent>
                                {NEGOTIATION_TYPES.map(t => (<SelectItem key={t} value={t}>{NEGOTIATION_TYPE_LABELS[t]}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Serviços/Produtos</Label>
                            <div className="flex flex-wrap gap-3 mt-1">
                              {catalogProductNames.map(sp => (
                                <label key={sp} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <Checkbox checked={servicosProdutos.includes(sp)} onCheckedChange={(checked) => { if (checked) { setServicosProdutos(prev => [...prev, sp]); } else { setServicosProdutos(prev => prev.filter(s => s !== sp)); } }} />
                                  {sp}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Modelo de Serviço</Label>
                            <Select value={modeloServico} onValueChange={setModeloServico}>
                              <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="transacional">Transacional</SelectItem>
                                <SelectItem value="saas">SAAS</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">kWp</Label>
                            <Input type="number" value={kwp} onChange={e => setKwp(e.target.value)} className="h-9" step="0.01" />
                          </div>
                          <div className="col-span-2 space-y-1.5">
                            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                              Comissão (€)
                              {servicosProdutos.some(p => isAutoCalculated(p)) && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20">Auto</Badge>
                              )}
                            </Label>
                            <Input 
                              type="number" 
                              value={comissao} 
                              onChange={e => setComissao(e.target.value)} 
                              className="h-9" 
                              step="0.01"
                              readOnly={servicosProdutos.some(p => isAutoCalculated(p))}
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* CPEs (editable) */}
                  {isTelecom && editableCpes.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Zap className="h-4 w-4 text-amber-500" />
                          {cpeLabel}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        {editableCpes.map((cpe, idx) => (
                          <div key={idx} className="p-3 rounded-lg border bg-muted/30 space-y-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs">{cpe.equipment_type}</Badge>
                              {negotiationType === 'renovacao' ? (
                                <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">Renovação</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-500 border-green-500/30">Novo</Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Comercializador</Label>
                                <Input value={cpe.comercializador} onChange={e => { const u = [...editableCpes]; u[idx] = { ...u[idx], comercializador: e.target.value }; setEditableCpes(u); }} className="h-8 text-sm" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{serialLabel}</Label>
                                <Input value={cpe.serial_number || ""} onChange={e => { const u = [...editableCpes]; u[idx] = { ...u[idx], serial_number: e.target.value }; setEditableCpes(u); }} className="h-8 text-sm font-mono" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Início Contrato</Label>
                                <Input type="date" value={cpe.contrato_inicio || ""} onChange={e => {
                                  const u = [...editableCpes];
                                  const inicio = e.target.value;
                                  const fim = u[idx].contrato_fim;
                                  let duracao = u[idx].duracao_contrato;
                                  if (inicio && fim) {
                                    const days = (new Date(fim).getTime() - new Date(inicio).getTime()) / 86400000;
                                    duracao = days > 0 ? parseFloat((days / 365).toFixed(3)) : null;
                                  }
                                  u[idx] = { ...u[idx], contrato_inicio: inicio || null, duracao_contrato: duracao };
                                  setEditableCpes(u);
                                }} className="h-8 text-sm" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Fim Contrato</Label>
                                <Input type="date" value={cpe.contrato_fim || ""} onChange={e => {
                                  const u = [...editableCpes];
                                  const fim = e.target.value;
                                  const inicio = u[idx].contrato_inicio;
                                  let duracao = u[idx].duracao_contrato;
                                  if (inicio && fim) {
                                    const days = (new Date(fim).getTime() - new Date(inicio).getTime()) / 86400000;
                                    duracao = days > 0 ? parseFloat((days / 365).toFixed(3)) : null;
                                  }
                                  u[idx] = { ...u[idx], contrato_fim: fim || null, duracao_contrato: duracao };
                                  setEditableCpes(u);
                                }} className="h-8 text-sm" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Duração (anos)</Label>
                                <Input type="number" value={cpe.duracao_contrato ?? ""} className="h-8 text-sm bg-muted" disabled />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Consumo (kWh)</Label>
                                <Input type="number" value={cpe.consumo_anual ?? ""} onChange={e => {
                                  const u = [...editableCpes];
                                  const newConsumo = e.target.value ? parseFloat(e.target.value) : null;
                                  const currentMargem = u[idx].margem ?? 0;
                                  let newComissao = u[idx].comissao;
                                  if (hasEnergyConfigRef.current && currentMargem > 0) {
                                    const calc = calcCommissionRef.current(currentMargem, getVolumeTier(newConsumo || 0));
                                    if (calc !== null) newComissao = parseFloat(calc.toFixed(2));
                                  }
                                  u[idx] = { ...u[idx], consumo_anual: newConsumo, comissao: newComissao };
                                  setEditableCpes(u);
                                }} className="h-8 text-sm" step="0.01" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">DBL</Label>
                                <Input type="number" value={cpe.dbl ?? ""} onChange={e => { const u = [...editableCpes]; u[idx] = { ...u[idx], dbl: e.target.value ? parseFloat(e.target.value) : null }; setEditableCpes(u); }} className="h-8 text-sm" step="0.01" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Margem (€/MWh)</Label>
                                <Input type="number" value={cpe.margem ?? ""} onChange={e => {
                                  const u = [...editableCpes];
                                  const newMargem = e.target.value ? parseFloat(e.target.value) : null;
                                  const currentConsumo = u[idx].consumo_anual ?? 0;
                                  let newComissao = u[idx].comissao;
                                  if (hasEnergyConfigRef.current && newMargem && newMargem > 0) {
                                    const calc = calcCommissionRef.current(newMargem, getVolumeTier(currentConsumo));
                                    if (calc !== null) newComissao = parseFloat(calc.toFixed(2));
                                  }
                                  u[idx] = { ...u[idx], margem: newMargem, comissao: newComissao };
                                  setEditableCpes(u);
                                }} className="h-8 text-sm" step="0.01" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Comissão (€)</Label>
                                <Input type="number" value={cpe.comissao ?? ""} onChange={e => { const u = [...editableCpes]; u[idx] = { ...u[idx], comissao: e.target.value ? parseFloat(e.target.value) : null }; setEditableCpes(u); }} className="h-8 text-sm" step="0.01" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Client CPEs (read-only, no proposal) */}
                  {isTelecom && editableCpes.length === 0 && clientCpes.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Zap className="h-4 w-4 text-amber-500" />
                          {cpeLabel}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-2">
                        {clientCpes.map((cpe) => {
                          const statusStyle = CPE_STATUS_STYLES[cpe.status as keyof typeof CPE_STATUS_STYLES];
                          return (
                            <div key={cpe.id} className="p-3 rounded-lg border bg-muted/30 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-xs">{cpe.equipment_type}</Badge>
                                <Badge variant="secondary" className="text-xs">{cpe.comercializador}</Badge>
                                {statusStyle && (
                                  <Badge variant="outline" className={`text-xs ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                                    {CPE_STATUS_LABELS[cpe.status as keyof typeof CPE_STATUS_LABELS]}
                                  </Badge>
                                )}
                              </div>
                              {cpe.serial_number && (
                                <div>
                                  <p className="text-xs text-muted-foreground">{serialLabel}</p>
                                  <p className="text-sm font-mono">{cpe.serial_number}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  )}

                  {canFullEdit && !isTelecom && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Package className="h-4 w-4" />
                          Produtos/Serviços
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        {items.length > 0 && (
                          <div className="space-y-2">
                            {items.map((item) => {
                              const product = products?.find(p => p.id === item.product_id);
                              const isRecurring = product?.is_recurring;
                              
                              return (
                                <div
                                  key={item.id}
                                  className="p-3 rounded-lg border bg-card space-y-2"
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <Input
                                          value={item.name}
                                          onChange={(e) => handleUpdateName(item.id, e.target.value)}
                                          className="h-8 text-sm font-medium"
                                        />
                                        {ixActive && <VatBadge taxValue={vatCalc.getItemTaxRate(item.product_id)} />}
                                      </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-1">
                                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleUpdateQuantity(item.id, -0.5)}>
                                        <Minus className="h-3 w-3" />
                                      </Button>
                                      <span className="w-6 text-center text-sm">{item.quantity}</span>
                                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleUpdateQuantity(item.id, 0.5)}>
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                    </div>

                                    <div className="w-24">
                                      <Input
                                        type="number"
                                        value={item.unit_price}
                                        onChange={(e) => handleUpdatePrice(item.id, e.target.value)}
                                        className="h-8 text-sm text-right"
                                        step="0.01"
                                        min="0"
                                      />
                                    </div>

                                    <div className="w-20 text-right text-sm font-medium">
                                      {formatCurrency(item.quantity * item.unit_price)}
                                    </div>

                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveItem(item.id)}>
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  
                                  {isRecurring && (
                                    <div className="flex items-center gap-2 pl-2 text-sm border-t pt-2 mt-2">
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
                                        <RefreshCw className="h-3 w-3 mr-1" />
                                        Mensal
                                      </Badge>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <SearchableCombobox
                          options={productOptions}
                          value=""
                          onValueChange={handleAddProduct}
                          placeholder="+ Adicionar produto..."
                          searchPlaceholder="Pesquisar produto..."
                          emptyText="Nenhum produto encontrado"
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* Payments */}
                  {organization && !isTelecom && (
                    <Card>
                      <CardContent className="p-4">
                        <SalePaymentsList
                          saleId={sale.id}
                          organizationId={organization.id}
                          saleTotal={grossValue}
                          readonly={!canFullEdit && sale.status === 'cancelled'}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* O painel por ciclo substitui o resumo antigo, que mostrava
                      só a próxima renovação e escondia o histórico: não dava
                      para ver que meses foram cobrados nem quais ficaram por
                      liquidar. */}
                  {sale.has_recurring && organization && (
                    <RecurringSalePanel saleId={sale.id} />
                  )}
                </div>

                {/* RIGHT COLUMN (40%) - Sticky */}
                <div className="lg:col-span-2">
                  <div className="lg:sticky lg:top-6 space-y-4">
                    {/* Summary Card */}
                    {canFullEdit && (
                      <Card>
                        <CardHeader className="pb-2 p-4">
                          <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                            <FileText className="h-4 w-4" />
                            Resumo
                          </CardTitle>
                        </CardHeader>
                         <CardContent className="p-4 pt-0 space-y-3">
                          {isTelecom ? (
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Comissão</span>
                              <span className="font-medium">{formatCurrency(sellerCommissionTotal)}</span>
                            </div>
                          ) : !hasItems ? (
                            <div className="space-y-1.5">
                              <Label className="text-sm text-muted-foreground">Valor Total</Label>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">€</span>
                                <Input
                                  type="number"
                                  value={manualTotalValue}
                                  onChange={(e) => setManualTotalValue(e.target.value)}
                                  className="h-8 text-right"
                                  step="0.01"
                                  min="0"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Subtotal</span>
                              <span>{formatCurrency(subtotal)}</span>
                            </div>
                          )}
                          
                          {hasItems && (
                            <div className="flex items-center justify-between gap-4">
                              <Label className="text-sm text-muted-foreground">Desconto</Label>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">€</span>
                                <Input
                                  type="number"
                                  value={discount}
                                  onChange={(e) => setDiscount(e.target.value)}
                                  className="w-24 h-8 text-right"
                                  step="0.01"
                                  min="0"
                                />
                              </div>
                            </div>
                          )}
                          
                          <Separator />

                          {ixActive && (
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">IVA</span>
                              <span className="font-medium">{formatCurrency(vatCalc.totalVat)}</span>
                            </div>
                          )}
                          
                          <div className="flex justify-between text-lg font-semibold">
                            <span>{isTelecom ? 'Comissão' : ixActive ? 'Total (s/ IVA)' : 'Total'}</span>
                            <span className="text-primary">
                              {formatCurrency(isTelecom ? sellerCommissionTotal : total)}
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
                    )}

                    {/* Payment Progress */}
                    {organization?.niche !== 'telecom' && salePayments.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2 p-4">
                          <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                            <CreditCard className="h-4 w-4" />
                            Pagamento
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 space-y-4">
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Progresso</span>
                              <span>{Math.round(paymentSummary.percentage)}%</span>
                            </div>
                            <Progress value={paymentSummary.percentage} className="h-2" />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs text-muted-foreground">Total Pago</p>
                              <p className="text-sm font-semibold text-green-500">{formatCurrency(paymentSummary.totalPaid)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Em Falta</p>
                              <p className="text-sm font-semibold text-amber-500">{formatCurrency(paymentSummary.remaining)}</p>
                            </div>
                          </div>
                          {paymentSummary.totalScheduled > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground">Agendado</p>
                              <p className="text-sm font-semibold">{formatCurrency(paymentSummary.totalScheduled)}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Notes */}
                    {/* EDP Proposal Number */}
                    {/* Only exists once the sale is actually under an operator,
                        and is named after that operator — there is no "EDP
                        number" on a NOS sale. Never required: the number often
                        only arrives after the sale is closed. */}
                    {saleFields?.edp_proposal_number?.visible && saleOperatorNames.length > 0 && (<Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
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
            {isDeliveredLocked && (
              <div className="flex items-center gap-2 text-amber-500 text-sm mb-3 max-w-6xl mx-auto">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Esta venda está concluída. Apenas administradores podem editar.</span>
              </div>
            )}
            <div className="flex gap-3 max-w-6xl mx-auto">
              <Button
                type="submit"
                variant="senvia"
                className="flex-1"
                size="lg"
                disabled={isSubmitting || isDeliveredLocked}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    A guardar...
                  </>
                ) : (
                  "Guardar Alterações"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                size="lg"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
