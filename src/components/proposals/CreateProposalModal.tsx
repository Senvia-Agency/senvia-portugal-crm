import { useState, useMemo, useEffect } from 'react';
import { Plus, UserPlus, Zap, Wrench, Package, FileText, User } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableCombobox, type ComboboxOption } from '@/components/ui/searchable-combobox';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { useCreateProposal } from '@/hooks/useProposals';
import { useModules } from '@/hooks/useModules';
import { useClients } from '@/hooks/useClients';
import { useCreateProposalCpesBatch } from '@/hooks/useProposalCpes';
import { useActiveProducts } from '@/hooks/useProducts';
import { CreateClientModal } from '@/components/clients/CreateClientModal';
import { CreateSaleModal } from '@/components/sales/CreateSaleModal';
import { useNavigate } from 'react-router-dom';
import { ProposalCpeSelector, type ProposalCpeDraft } from '@/components/proposals/ProposalCpeSelector';
import { useAuth } from '@/contexts/AuthContext';
import { useCommissionMatrix } from '@/hooks/useCommissionMatrix';
import type { CrmClient } from '@/types/clients';
import { 
  PROPOSAL_STATUS_LABELS, 
  PROPOSAL_STATUSES, 
  NEGOTIATION_TYPE_LABELS,
  NEGOTIATION_TYPES,
  FIELD_LABELS,
  type ServicosDetails,
  type ServicosProductDetail,
  type ProposalStatus, 
  type ProposalType,
  type ModeloServico,
  type NegotiationType,
  type Proposal,
  getCatalogCommission,
} from '@/types/proposals';
import { useServicosProducts } from '@/hooks/useServicosProducts';
import { ServicosSection } from '@/components/proposals/ServicosSection';
import { DocumentsCheckboxField, ContractSignedCheckboxField } from '@/components/shared/DocumentsCheckboxField';
import { useLanguage } from "@/i18n";

interface CreateProposalModalProps {
  client?: CrmClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (proposal: Proposal) => void;
  preselectedClientId?: string | null;
  leadId?: string | null;
}

export function CreateProposalModal({ client, open, onOpenChange, onSuccess, preselectedClientId, leadId }: CreateProposalModalProps) {
  const { t } = useLanguage();
  const { data: clients = [] } = useClients();
  const { data: products = [] } = useActiveProducts();
  const { organization } = useAuth();
  const { products: SERVICOS_PRODUCTS, configs: SERVICOS_PRODUCT_CONFIGS, catalog, isNewFormat, operators: catalogOperators } = useServicosProducts();
  const { calculateCommission, isAutoCalculated } = useCommissionMatrix();
  const createProposal = useCreateProposal();
  const createProposalCpesBatch = useCreateProposalCpesBatch();
  
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  
  const [selectedClientId, setSelectedClientId] = useState<string | null>(client?.id || null);
  const [notes, setNotes] = useState('');
  const [proposalDate, setProposalDate] = useState(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<ProposalStatus>('draft');
  
  const [proposalType, setProposalType] = useState<ProposalType>('energia');
  const [negotiationType, setNegotiationType] = useState<NegotiationType>('angariacao');
  
  const [modeloServico, setModeloServico] = useState<ModeloServico>('transacional');
  const [comissaoServicos, setComissaoServicos] = useState<string>('');
  const [servicosProdutos, setServicosProdutos] = useState<string[]>([]);
  const [servicosDetails, setServicosDetails] = useState<ServicosDetails>({});
  const [documentsChecked, setDocumentsChecked] = useState(false);
  const [contractSigned, setContractSigned] = useState(false);
  
  const [proposalCpes, setProposalCpes] = useState<ProposalCpeDraft[]>([]);
  
  const [selectedProducts, setSelectedProducts] = useState<Array<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    discount_type: 'percentage' | 'fixed';
    discount_value: number;
  }>>([]);
  
  const [isCreateClientOpen, setIsCreateClientOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);

  // Proposta criada já como "Aceite" → abre o modal de venda
  const navigate = useNavigate();
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [acceptedProposal, setAcceptedProposal] = useState<Proposal | null>(null);

  // validation moved after totalKwp declaration

  useEffect(() => {
    if (open) {
      if (preselectedClientId) {
        setSelectedClientId(preselectedClientId);
      } else if (client?.id) {
        setSelectedClientId(client.id);
      }
    }
  }, [open, client?.id, preselectedClientId]);

  const getProductTotal = (product: typeof selectedProducts[0]) => {
    const subtotal = product.quantity * product.unit_price;
    if (product.discount_type === 'percentage') {
      return subtotal * (1 - product.discount_value / 100);
    }
    return Math.max(0, subtotal - product.discount_value);
  };

  const totalValue = useMemo(() => {
    if (isTelecom) {
      if (proposalType === 'energia') {
        return proposalCpes.reduce((sum, cpe) => sum + (parseFloat(cpe.margem) || 0), 0);
      }
      return 0;
    }
    const productsTotal = selectedProducts.reduce((sum, p) => sum + getProductTotal(p), 0);
    return productsTotal;
  }, [isTelecom, proposalType, proposalCpes, selectedProducts]);

  const totalComissao = useMemo(() => {
    if (proposalType === 'energia') {
      return proposalCpes.reduce((sum, cpe) => sum + (parseFloat(cpe.comissao) || 0), 0);
    }
    // Sum comissao from each active servicos product
    return servicosProdutos.reduce((sum, p) => sum + (servicosDetails[p]?.comissao || 0), 0);
  }, [proposalType, proposalCpes, servicosProdutos, servicosDetails]);

  const handleClientCreated = (newClientId: string) => {
    setSelectedClientId(newClientId);
  };

  const handleProposalTypeChange = (nextType: ProposalType) => {
    setProposalType(nextType);

    if (nextType === 'energia') {
      setServicosProdutos([]);
      setServicosDetails({});
      setModeloServico('transacional');
      setComissaoServicos('');
      return;
    }

    setProposalCpes([]);
  };

  const handleToggleServicoProduto = (produto: string) => {
    setServicosProdutos(prev => {
      if (prev.includes(produto)) {
        setServicosDetails(d => { const n = { ...d }; delete n[produto]; return n; });
        return prev.filter(p => p !== produto);
      }
      // For new catalog format, initialize with catalog values
      if (isNewFormat && catalog) {
        const catProduct = catalog.find(c => c.name === produto);
        if (catProduct) {
          const comissao = getCatalogCommission(catProduct);
          setServicosDetails(d => ({
            ...d,
            [produto]: {
              name: catProduct.name,
              price: catProduct.price,
              commission_pct: catProduct.commission_pct,
              commission_type: catProduct.commission_type ?? 'pct',
              commission_fixed: catProduct.commission_fixed ?? 0,
              comissao,
            },
          }));
        }
      }
      return [...prev, produto];
    });
  };

  const handleSetProductDetail = (produto: string, detail: import('@/types/proposals').ServicosProductDetail) => {
    setServicosDetails(prev => ({ ...prev, [produto]: detail }));
  };

  const handleUpdateProductDetail = (produto: string, field: string, value: number | undefined) => {
    setServicosDetails(prev => {
      const detail = { ...prev[produto], [field]: value };
      // Auto-calc kWp for Condensadores
      const config = SERVICOS_PRODUCT_CONFIGS.find(c => c.name === produto);
      if (config?.kwpAuto && field !== 'kwp') {
        const autoKwp = config.kwpAuto(detail);
        if (autoKwp !== null) detail.kwp = Math.round(autoKwp * 100) / 100;
      }
      // Auto-calc comissao via matrix
      if (field !== 'comissao') {
        const calc = calculateCommission(produto, detail, modeloServico);
        if (calc !== null) detail.comissao = Math.round(calc * 100) / 100;
      }
      return { ...prev, [produto]: detail };
    });
  };

  // Recalculate commissions when modeloServico changes (Transacional <-> SAAS)
  useEffect(() => {
    if (proposalType !== 'servicos' || servicosProdutos.length === 0) return;
    setServicosDetails(prev => {
      const updated = { ...prev };
      for (const prodName of servicosProdutos) {
        const detail = { ...updated[prodName] };
        const config = SERVICOS_PRODUCT_CONFIGS.find(c => c.name === prodName);
        if (config?.kwpAuto) {
          const autoKwp = config.kwpAuto(detail);
          if (autoKwp !== null) detail.kwp = Math.round(autoKwp * 100) / 100;
        }
        const calc = calculateCommission(prodName, detail, modeloServico);
        if (calc !== null) detail.comissao = Math.round(calc * 100) / 100;
        updated[prodName] = detail;
      }
      return updated;
    });
  }, [modeloServico]);

  const totalKwp = useMemo(() => {
    return Object.values(servicosDetails).reduce((sum, d) => sum + (d.kwp || 0), 0);
  }, [servicosDetails]);

  const isServicosValid = useMemo(() => {
    if (!isTelecom || proposalType !== 'servicos') return true;
    if (servicosProdutos.length === 0) return false;
    return servicosProdutos.every(produto => {
      const config = SERVICOS_PRODUCT_CONFIGS.find(c => c.name === produto);
      const detail = servicosDetails[produto] || {};
      return config?.fields.every(field => 
        detail[field] !== undefined && detail[field] > 0
      ) ?? false;
    });
  }, [isTelecom, proposalType, servicosProdutos, servicosDetails]);

  const isEnergiaValid = useMemo(() => {
    if (!isTelecom || proposalType !== 'energia') return true;
    return proposalCpes.length > 0 && proposalCpes.every(cpe => 
      cpe.consumo_anual && cpe.duracao_contrato && cpe.dbl 
      && cpe.comissao && cpe.contrato_inicio && cpe.contrato_fim
    );
  }, [isTelecom, proposalType, proposalCpes]);

  const isGenericValid = useMemo(() => {
    if (isTelecom) return true;
    return selectedProducts.length > 0;
  }, [isTelecom, selectedProducts]);

  const isFormValid = isServicosValid && isEnergiaValid && isGenericValid && !!selectedClientId;

  const handleAddProduct = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const existing = selectedProducts.find(p => p.product_id === productId);
    if (existing) {
      setSelectedProducts(prev => 
        prev.map(p => p.product_id === productId ? { ...p, quantity: p.quantity + 1 } : p)
      );
    } else {
      setSelectedProducts(prev => [...prev, {
        product_id: product.id,
        name: product.name,
        quantity: 1,
        unit_price: product.price || 0,
        discount_type: 'percentage' as const,
        discount_value: 0,
      }]);
    }
  };

  const handleUpdateProductPrice = (productId: string, price: number) => {
    setSelectedProducts(prev => 
      prev.map(p => p.product_id === productId ? { ...p, unit_price: price } : p)
    );
  };

  const handleUpdateProductDiscount = (
    productId: string, 
    discountType: 'percentage' | 'fixed', 
    discountValue: number
  ) => {
    setSelectedProducts(prev => 
      prev.map(p => p.product_id === productId 
        ? { ...p, discount_type: discountType, discount_value: discountValue } 
        : p
      )
    );
  };

  const handleRemoveProduct = (productId: string) => {
    setSelectedProducts(prev => prev.filter(p => p.product_id !== productId));
  };

  const handleUpdateProductQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveProduct(productId);
      return;
    }
    setSelectedProducts(prev => 
      prev.map(p => p.product_id === productId ? { ...p, quantity } : p)
    );
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!isFormValid) return;

    createProposal.mutate({
      client_id: selectedClientId || undefined,
      lead_id: leadId || undefined,
      total_value: totalValue,
      status: status,
      notes: notes.trim() || undefined,
      proposal_date: proposalDate,
      products: !isTelecom
        ? selectedProducts.map((p) => ({
            product_id: p.product_id,
            quantity: p.quantity,
            unit_price: p.unit_price,
            total: getProductTotal(p),
          }))
        : [],
      proposal_type: isTelecom ? proposalType : undefined,
      negotiation_type: isTelecom ? negotiationType : undefined,
      kwp: proposalType === 'servicos' ? (totalKwp || undefined) : undefined,
      modelo_servico: proposalType === 'servicos' ? modeloServico : undefined,
      comissao: totalComissao || undefined,
      servicos_produtos: proposalType === 'servicos' && servicosProdutos.length > 0 ? servicosProdutos : undefined,
      servicos_details: proposalType === 'servicos' && Object.keys(servicosDetails).length > 0 ? servicosDetails : undefined,
      documents_checked: isTelecom ? documentsChecked : undefined,
      contract_signed: isTelecom ? contractSigned : undefined,
      }, {
        onSuccess: async (createdProposal) => {
          if (proposalType === 'energia' && proposalCpes.length > 0 && createdProposal?.id) {
            await createProposalCpesBatch.mutateAsync(
              proposalCpes.map(cpe => ({
                proposal_id: createdProposal.id,
                existing_cpe_id: cpe.existing_cpe_id,
                equipment_type: cpe.equipment_type,
                serial_number: cpe.serial_number || null,
                comercializador: cpe.comercializador,
                fidelizacao_start: cpe.fidelizacao_start || null,
                fidelizacao_end: cpe.fidelizacao_end || null,
                notes: cpe.notes || null,
                consumo_anual: cpe.consumo_anual ? parseFloat(cpe.consumo_anual) : null,
                duracao_contrato: cpe.duracao_contrato ? parseInt(cpe.duracao_contrato) : null,
                dbl: cpe.dbl ? parseFloat(cpe.dbl) : null,
                margem: cpe.margem ? parseFloat(cpe.margem) : null,
                comissao: cpe.comissao ? parseFloat(cpe.comissao) : null,
                contrato_inicio: cpe.contrato_inicio || null,
                contrato_fim: cpe.contrato_fim || null,
              }))
            );
          }
        
        // Captura antes do reset do formulário
        const wasAccepted = status === 'accepted';

        setSelectedClientId(null);
        setNotes('');
        setProposalDate(new Date().toISOString().split('T')[0]);
        setStatus('draft');
        setProposalCpes([]);
        setProposalType('energia');
        setNegotiationType('angariacao');
        setModeloServico('transacional');
        setComissaoServicos('');
        setServicosProdutos([]);
        setServicosDetails({});
        setSelectedProducts([]);

        onOpenChange(false);
        onSuccess?.(createdProposal as Proposal);

        // Se foi criada como "Aceite", abre o modal de venda já pré-preenchido
        if (wasAccepted && createdProposal?.id) {
          setAcceptedProposal(createdProposal as Proposal);
          setShowSaleModal(true);
        }
      },
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pr-14 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {t("Nova Proposta")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto p-4 sm:p-6">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* LEFT COLUMN (60%) */}
                <div className="lg:col-span-3 space-y-4">
                  {/* Info Básica */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <User className="h-4 w-4" />
                        {t("Informação Básica")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-4">
                      <div className="space-y-2">
                        <Label>{t("Cliente")} <span className="text-destructive">*</span></Label>
                        <div className="flex gap-2">
                          <SearchableCombobox
                            options={clients.map((c): ComboboxOption => ({
                              value: c.id,
                              label: c.name,
                              sublabel: c.code || c.email || undefined,
                            }))}
                            value={selectedClientId}
                            onValueChange={setSelectedClientId}
                            placeholder={t("Selecionar cliente...")}
                            searchPlaceholder={t("Pesquisar cliente...")}
                            emptyLabel={t("Sem cliente associado")}
                            emptyText={t("Nenhum cliente encontrado.")}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setIsCreateClientOpen(true)}
                            title={t("Novo Cliente")}
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        </div>
                        {attempted && !selectedClientId && (
                          <p className="text-xs text-destructive">{t("Selecione um cliente")}</p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="proposal-date">{t("Data da Proposta")}</Label>
                          <Input
                            id="proposal-date"
                            type="date"
                            value={proposalDate}
                            onChange={(e) => setProposalDate(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="status">{t("Estado")}</Label>
                          <Select value={status} onValueChange={(v) => setStatus(v as ProposalStatus)}>
                            <SelectTrigger id="status">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PROPOSAL_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {t(PROPOSAL_STATUS_LABELS[s])}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Tipo de Negociação (apenas telecom) */}
                  {isTelecom && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t("Tipo de Negociação")}</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-2 gap-2">
                          {NEGOTIATION_TYPES.map((type) => (
                            <Button
                              key={type}
                              type="button"
                              variant={negotiationType === type ? 'default' : 'outline'}
                              size="sm"
                              className="h-9 text-xs"
                              onClick={() => setNegotiationType(type)}
                            >
                              {t(NEGOTIATION_TYPE_LABELS[type])}
                            </Button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Tipo de Proposta (apenas telecom) */}
                  {showEnergy && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t("Tipo de Proposta")}</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant={proposalType === 'energia' ? 'default' : 'outline'}
                            className="flex items-center justify-center gap-2 h-12"
                            onClick={() => handleProposalTypeChange('energia')}
                          >
                            <Zap className="h-4 w-4" />
                            {t("Energia")}
                          </Button>
                          <Button
                            type="button"
                            variant={proposalType === 'servicos' ? 'default' : 'outline'}
                            className="flex items-center justify-center gap-2 h-12"
                            onClick={() => handleProposalTypeChange('servicos')}
                          >
                            <Wrench className="h-4 w-4" />
                            {t("Outros Serviços")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* CPE Selector para propostas de Energia */}
                  {isTelecom && proposalType === 'energia' && (
                    <Card>
                      <CardContent className="p-4">
                        {attempted && !isEnergiaValid && (
                          <p className="text-xs text-destructive mb-2">
                            {proposalCpes.length === 0 
                              ? t("Adicione pelo menos 1 CPE/CUI") 
                              : t("Todos os campos de cada CPE são obrigatórios")}
                          </p>
                        )}
                        <ProposalCpeSelector
                          clientId={selectedClientId}
                          cpes={proposalCpes}
                          onCpesChange={setProposalCpes}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* Campos específicos de Serviços */}
                  {isTelecom && proposalType === 'servicos' && (
                    <Card>
                      <CardContent className="p-4">
                        <ServicosSection
                          modeloServico={modeloServico}
                          onModeloServicoChange={setModeloServico}
                          servicosProdutos={servicosProdutos}
                          servicosDetails={servicosDetails}
                          attempted={attempted}
                          isNewFormat={isNewFormat}
                          configs={SERVICOS_PRODUCT_CONFIGS}
                          catalog={catalog}
                          operators={catalogOperators}
                          onToggleProduct={handleToggleServicoProduto}
                          onUpdateDetail={handleUpdateProductDetail}
                          onSetProductDetail={handleSetProductDetail}
                          isAutoCalculated={isAutoCalculated}
                          totalKwp={totalKwp}
                          totalComissao={totalComissao}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* Campos para nichos NÃO-telecom */}
                  {!isTelecom && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Package className="h-4 w-4" />
                          {t("Produtos/Serviços")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        {attempted && !isGenericValid && (
                          <p className="text-xs text-destructive">{t("Adicione pelo menos 1 produto")}</p>
                        )}
                        {products.length > 0 && (
                          <>
                            <Select onValueChange={handleAddProduct}>
                              <SelectTrigger>
                                <SelectValue placeholder={t("Adicionar produto/serviço...")} />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name} {product.price ? `- ${formatCurrency(product.price)}` : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            
                            {selectedProducts.length > 0 && (
                              <div className="space-y-3">
                                {selectedProducts.map((item) => {
                                  const subtotal = item.quantity * item.unit_price;
                                  const discountedTotal = getProductTotal(item);
                                  const hasDiscount = item.discount_value > 0;
                                  
                                  return (
                                    <div key={item.product_id} className="p-3 rounded-lg bg-muted space-y-2">
                                      <div className="flex items-center gap-2">
                                        <Package className="h-4 w-4 text-muted-foreground" />
                                        <span className="flex-1 text-sm font-medium">{item.name}</span>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0"
                                          onClick={() => handleRemoveProduct(item.product_id)}
                                        >
                                          ×
                                        </Button>
                                      </div>
                                      
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-xs text-muted-foreground">{t("Quantidade")}</Label>
                                          <Input
                                            type="number"
                                            min="0.5"
                                            step="0.5"
                                            value={item.quantity}
                                            onChange={(e) => handleUpdateProductQuantity(item.product_id, parseFloat(e.target.value) || 0)}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs text-muted-foreground">{t("Preço Unit.")}</Label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={item.unit_price}
                                            onChange={(e) => handleUpdateProductPrice(item.product_id, parseFloat(e.target.value) || 0)}
                                            className="h-8"
                                          />
                                        </div>
                                      </div>
                                      
                                      <div className="flex items-end gap-2">
                                        <div className="flex-1">
                                          <Label className="text-xs text-muted-foreground">{t("Desconto")}</Label>
                                          <div className="flex gap-1">
                                            <Button
                                              type="button"
                                              variant={item.discount_type === 'percentage' ? 'default' : 'outline'}
                                              size="sm"
                                              className="h-8 w-10 p-0"
                                              onClick={() => handleUpdateProductDiscount(item.product_id, 'percentage', item.discount_value)}
                                            >
                                              %
                                            </Button>
                                            <Button
                                              type="button"
                                              variant={item.discount_type === 'fixed' ? 'default' : 'outline'}
                                              size="sm"
                                              className="h-8 w-10 p-0"
                                              onClick={() => handleUpdateProductDiscount(item.product_id, 'fixed', item.discount_value)}
                                            >
                                              €
                                            </Button>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              value={item.discount_value || ''}
                                              onChange={(e) => handleUpdateProductDiscount(
                                                item.product_id, 
                                                item.discount_type, 
                                                parseFloat(e.target.value) || 0
                                              )}
                                              className="h-8 flex-1"
                                              placeholder="0"
                                            />
                                          </div>
                                        </div>
                                        <div className="text-right min-w-[80px]">
                                          <Label className="text-xs text-muted-foreground">{t("Subtotal")}</Label>
                                          <div className="text-sm font-medium">
                                            {hasDiscount && (
                                              <span className="text-xs text-muted-foreground line-through mr-1">
                                                {formatCurrency(subtotal)}
                                              </span>
                                            )}
                                            <span className={hasDiscount ? 'text-green-600' : ''}>
                                              {formatCurrency(discountedTotal)}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Documentos / Contrato (apenas telecom) */}
                  {isTelecom && (
                    <Card>
                      <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <DocumentsCheckboxField id="create-proposal-documents" checked={documentsChecked} onChange={setDocumentsChecked} />
                        <ContractSignedCheckboxField id="create-proposal-contract" checked={contractSigned} onChange={setContractSigned} />
                      </CardContent>
                    </Card>
                  )}

                  {/* Observações */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium text-muted-foreground">{t("Observações da Negociação")}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <Textarea
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={t("Detalhes da negociação, condições especiais, etc...")}
                        rows={3}
                      />
                    </CardContent>
                  </Card>
                </div>

                {/* RIGHT COLUMN (40%) - Sticky */}
                <div className="lg:col-span-2">
                  <div className="lg:sticky lg:top-6 space-y-4">
                    {/* Resumo */}
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <FileText className="h-4 w-4" />
                          {t("Resumo")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        {isTelecom && proposalType === 'energia' && proposalCpes.length > 0 && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{t("CPE/CUI adicionados")}</span>
                              <span className="font-medium">{proposalCpes.length}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{t("Comissão Total")}</span>
                              <span className="font-medium">{formatCurrency(totalComissao)}</span>
                            </div>
                            <Separator />
                          </>
                        )}

                        <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 text-center">
                          <p className="text-sm text-muted-foreground mb-1">{t("Total da Proposta")}</p>
                          <p className="text-2xl font-bold text-primary">{formatCurrency(totalValue)}</p>
                          {isTelecom && proposalType === 'energia' && proposalCpes.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {t("Soma das margens de {{n}} CPE(s)", { n: proposalCpes.length })}
                            </p>
                          )}
                        </div>
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
                disabled={createProposal.isPending || (attempted && !isFormValid)}
              >
                {createProposal.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("A criar...")}
                  </>
                ) : (
                  t("Criar Proposta")
                )}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                size="lg"
                onClick={() => onOpenChange(false)}
              >
                {t("Cancelar")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CreateClientModal
        open={isCreateClientOpen}
        onOpenChange={setIsCreateClientOpen}
        onCreated={handleClientCreated}
      />

      {acceptedProposal && (
        <CreateSaleModal
          open={showSaleModal}
          onOpenChange={(o) => {
            setShowSaleModal(o);
            if (!o) setAcceptedProposal(null);
          }}
          prefillProposal={acceptedProposal}
          prefillClientId={acceptedProposal.client_id}
          prefillClient={(() => {
            const c = clients.find((cl) => cl.id === acceptedProposal.client_id);
            return c ? { id: c.id, name: c.name, email: c.email, nif: c.nif, code: c.code } : null;
          })()}
          onSaleCreated={() => {
            setShowSaleModal(false);
            setAcceptedProposal(null);
            navigate('/sales');
          }}
        />
      )}
    </>
  );
}
