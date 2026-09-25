import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from "@/contexts/AuthContext";
import { useUpdateOrganization } from '@/hooks/useOrganization';
import { SecuritySettings } from '@/components/settings/SecuritySettings';
import { useUpdateProfile, useChangePassword } from '@/hooks/useProfile';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { PipelineEditor } from '@/components/settings/PipelineEditor';
import { ProductsTab } from '@/components/settings/ProductsTab';
import { ModulesTab } from '@/components/settings/ModulesTab';
import { supabase } from '@/integrations/supabase/client';
import { TeamTab } from '@/components/settings/TeamTab';
import { TeamsSection } from '@/components/settings/TeamsSection';
import { FormsManager } from '@/components/settings/FormsManager';
import { ProfileContent } from '@/components/settings/ProfileContent';
import { CompanyContent } from '@/components/settings/CompanyContent';
import { IntegrationsContent } from '@/components/settings/IntegrationsContent';
import { FieldsManagerTabs } from '@/components/settings/FieldsManagerTabs';
import { FidelizationAlertsSettings } from '@/components/settings/FidelizationAlertsSettings';
import { CalendarAlertsSettings } from '@/components/settings/CalendarAlertsSettings';
import { NotificationEmailSettings } from '@/components/settings/NotificationEmailSettings';
import { ExpenseCategoriesTab } from '@/components/settings/ExpenseCategoriesTab';
import { FiscalSettingsTab } from '@/components/settings/FiscalSettingsTab';
import { SalesSettingsTab } from '@/components/settings/SalesSettingsTab';
import { CommissionMatrixTab } from '@/components/settings/CommissionMatrixTab';
import { OperatorsTab } from '@/components/settings/OperatorsTab';
import { ClientDocumentTypesSettings } from '@/components/settings/ClientDocumentTypesSettings';
import { PushNotificationsCard } from '@/components/settings/PushNotificationsCard';
import { BillingTab } from '@/components/settings/BillingTab';
import { ReferralProgram } from '@/components/settings/ReferralProgram';
import { SupportTicketsTab } from '@/components/settings/SupportTicketsTab';
import type { VendusOptionsResponse } from '@/types/vendus';

import { ProfilesTab } from '@/components/settings/ProfilesTab';
import {
  MobileSettingsNav,
  SettingsSection,
  SettingsSubSection,
  getVisibleSubSections,
  sectionTitles,
} from '@/components/settings/MobileSettingsNav';

export default function Settings() {
  const { profile, organization, refetchUserData } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateOrganization = useUpdateOrganization();
  const updateFiscalOrganization = useUpdateOrganization({ silent: true });
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const { can, canManageTeam, canManageIntegrations, isAdmin } = usePermissions();
  const pushNotifications = usePushNotifications();

  // Unified navigation state (2 levels): group card -> tabbed content.
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeGroup, setActiveGroup] = useState<SettingsSection | null>(null);
  const [activeSub, setActiveSub] = useState<SettingsSubSection | null>(null);

  const isTelecom = organization?.niche === 'telecom';
  const subOpts = { isTelecom, canManageTeam, canManageIntegrations };

  // Auto-navigate to the plan tab when ?tab=billing (trial / payment banners) or
  // ?billing=success|cancel (Stripe checkout return) is present. The plan lives
  // under the "A Minha Conta" group. We only clear ?tab=billing — ?billing=success
  // must survive so BillingTab can fire the Purchase pixel and refresh the
  // subscription (it clears the param itself).
  useEffect(() => {
    const tab = searchParams.get('tab');
    const billing = searchParams.get('billing');
    if (tab === 'referrals') {
      setActiveGroup('account');
      setActiveSub('account-referrals');
      setSearchParams({}, { replace: true });
    }
    if (tab === 'billing' || billing) {
      setActiveGroup('account');
      setActiveSub('account-plan');
      if (tab === 'billing') setSearchParams({}, { replace: true });
    }
    // Deep link from the empty inbox: open Integrações → Caixas de Entrada.
    // ?addInbox=1 survives so IntegrationsContent can auto-open the "Nova caixa" dialog.
    if (tab === 'inboxes') {
      setActiveGroup('integrations');
      setActiveSub('integrations-connect');
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  }, []);

  // Generic deep-link used by Otto's guided tours to land directly on a settings
  // sub-section (e.g. ?og=sales&os=sales-pipeline). Its own effect on
  // [searchParams] so it also fires when navigating while already on /settings.
  useEffect(() => {
    const og = searchParams.get('og');
    const os = searchParams.get('os');
    if (!og) return;
    setActiveGroup(og as SettingsSection);
    if (os) setActiveSub(os as SettingsSubSection);
    const next = new URLSearchParams(searchParams);
    next.delete('og');
    next.delete('os');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);


  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true);

  // WhatsApp Business state
  const [whatsappBaseUrl, setWhatsappBaseUrl] = useState('');
  const [whatsappInstance, setWhatsappInstance] = useState('');
  /**
   * Que chaves já estão gravadas — não quais são.
   *
   * As colunas dos segredos deixaram de ser legíveis pelo browser (migração
   * 20260826140000): qualquer colaborador conseguia ler a chave da InvoiceXpress
   * da empresa e emitir faturação por fora do CRM com ela. O que a interface
   * precisa é só de saber se está configurada, para dizer "guardada" em vez de
   * mostrar um campo vazio que parece por preencher.
   *
   * Os campos passam a ser de ESCRITA APENAS: em branco quer dizer "manter a
   * atual", como na Stripe ou no GitHub.
   */
  const [chavesGuardadas, setChavesGuardadas] = useState({
    whatsapp: false, brevo: false, invoicexpress: false, keyinvoice: false,
  });
  const [whatsappApiKey, setWhatsappApiKey] = useState('');
  const [showWhatsappApiKey, setShowWhatsappApiKey] = useState(false);

  // Brevo Email state
  const [brevoApiKey, setBrevoApiKey] = useState('');
  const [brevoSenderEmail, setBrevoSenderEmail] = useState('');
  const [showBrevoApiKey, setShowBrevoApiKey] = useState(false);

  // InvoiceXpress state
  const [invoiceXpressAccountName, setInvoiceXpressAccountName] = useState('');
  const [invoiceXpressApiKey, setInvoiceXpressApiKey] = useState('');
  const [showInvoiceXpressApiKey, setShowInvoiceXpressApiKey] = useState(false);
  const [taxRate, setTaxRate] = useState('23');
  const [taxExemptionReason, setTaxExemptionReason] = useState('');
  const [isSavingFiscal, setIsSavingFiscal] = useState(false);

  // Vendus state
  const [vendusApiKey, setVendusApiKey] = useState('');
  const [showVendusApiKey, setShowVendusApiKey] = useState(false);
  const [vendusOptionsLoaded, setVendusOptionsLoaded] = useState(false);
  const [vendusRegisterReady, setVendusRegisterReady] = useState(false);
  const [vendusReadinessError, setVendusReadinessError] = useState('');
  const [vendusOptionsLoading, setVendusOptionsLoading] = useState(false);
  const vendusLookupSequence = useRef(0);

  // KeyInvoice state
  const [keyinvoiceApiKey, setKeyinvoiceApiKey] = useState('');
  const [keyinvoiceApiUrl, setKeyinvoiceApiUrl] = useState('');
  const [showKeyinvoiceApiKey, setShowKeyinvoiceApiKey] = useState(false);

  // Integrations enabled state
  const [integrationsEnabled, setIntegrationsEnabled] = useState<Record<string, boolean>>({
    webhook: true, whatsapp: true, brevo: true, invoicexpress: true, keyinvoice: false, vendus: false,
  });

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Organization edit state
  const [orgName, setOrgName] = useState('');

  // Profile edit state
  const [fullName, setFullName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [emailSignature, setEmailSignature] = useState('');
  const [profileBrevoSenderEmail, setProfileBrevoSenderEmail] = useState('');

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);


  // Initialize editable fields
  useEffect(() => {
    if (organization?.name) setOrgName(organization.name);
  }, [organization?.name]);

  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name);
    setProfileEmail((profile as any)?.email || '');
    setProfilePhone((profile as any)?.phone || '');
    setEmailSignature((profile as any)?.email_signature || '');
    setProfileBrevoSenderEmail((profile as any)?.brevo_sender_email || '');
  }, [profile?.full_name, (profile as any)?.email, (profile as any)?.phone, (profile as any)?.email_signature, (profile as any)?.brevo_sender_email]);

  // Fetch current integrations data
  useEffect(() => {
    async function fetchIntegrations() {
      if (!organization?.id) return;

      setIsLoadingIntegrations(true);
      setVendusApiKey('');
      setShowVendusApiKey(false);
      vendusLookupSequence.current += 1;
      setVendusOptionsLoaded(false);
      setVendusRegisterReady(false);
      setVendusReadinessError('');
      setVendusOptionsLoading(false);
      setChavesGuardadas((current) => ({ ...current, vendus: false }));
      const { data, error } = await supabase
        .from('organizations')
        // As chaves de API ja nao sao legiveis pelo cliente (ver a migracao
        // 20260826140000). Le-se se ESTAO configuradas; o valor nunca volta ao
        // browser, tal como na Stripe ou no GitHub.
        .select('webhook_url, whatsapp_base_url, whatsapp_instance, tem_whatsapp_api_key, form_settings, tem_brevo_api_key, brevo_sender_email, invoicexpress_account_name, tem_invoicexpress_api_key, integrations_enabled, tax_config, billing_provider, tem_keyinvoice_password, keyinvoice_api_url')
        .eq('id', organization.id)
        .single();

      if (!error && data) {
        setWhatsappBaseUrl(data.whatsapp_base_url || '');
        setWhatsappInstance(data.whatsapp_instance || '');


        setBrevoSenderEmail(data.brevo_sender_email || '');
        setInvoiceXpressAccountName((data as any).invoicexpress_account_name || '');
        // Um só cast, com os nomes escritos: as colunas `tem_*` são mais
        // recentes do que os tipos gerados do Supabase.
        const temChave = data as unknown as {
          tem_whatsapp_api_key?: boolean;
          tem_brevo_api_key?: boolean;
          tem_invoicexpress_api_key?: boolean;
          tem_keyinvoice_password?: boolean;
        };
        setChavesGuardadas({
          whatsapp: !!temChave.tem_whatsapp_api_key,
          brevo: !!temChave.tem_brevo_api_key,
          invoicexpress: !!temChave.tem_invoicexpress_api_key,
          keyinvoice: !!temChave.tem_keyinvoice_password,
          vendus: false,
        });

        // The Vendus columns are installed manually. A pending migration must
        // not prevent the other integrations from loading.
        const { data: vendusData } = await supabase.from('organizations')
          .select('tem_vendus_api_key')
          .eq('id', organization.id).maybeSingle();
        if (vendusData) {
          setChavesGuardadas((current) => ({ ...current, vendus: vendusData.tem_vendus_api_key === true }));
        }


        setKeyinvoiceApiUrl((data as any).keyinvoice_api_url || '');

        const tc = (data as any).tax_config;
        if (tc) {
          setTaxRate(String(tc.tax_value ?? 23));
          setTaxExemptionReason(tc.tax_exemption_reason || '');
        }

        if ((data as any).integrations_enabled) {
          setIntegrationsEnabled({
            webhook: true, whatsapp: true, brevo: true, invoicexpress: true, keyinvoice: false, vendus: false,
            ...((data as any).integrations_enabled as Record<string, boolean>),
          });
        }

      }
      setIsLoadingIntegrations(false);
    }

    fetchIntegrations();
  }, [organization?.id, refreshTrigger]);

  const handleToggleIntegration = async (key: string, enabled: boolean) => {
    if (!organization?.id) return;
    const previousState = integrationsEnabled;
    let newState = { ...integrationsEnabled, [key]: enabled };
    const fiscalProviders = ['invoicexpress', 'keyinvoice', 'vendus'] as const;
    if (enabled && fiscalProviders.some((provider) => provider === key)) {
      for (const provider of fiscalProviders) {
        if (provider !== key) newState[provider] = false;
      }
    }
    setIntegrationsEnabled(newState);

    let billingProviderValue: string | undefined;
    if (fiscalProviders.some((provider) => provider === key)) {
      if (newState.invoicexpress) billingProviderValue = 'invoicexpress';
      else if (newState.keyinvoice) billingProviderValue = 'keyinvoice';
      else if (newState.vendus) billingProviderValue = 'vendus';
      // The column is NOT NULL. With every fiscal integration disabled, keep
      // the last selected provider so it can be re-enabled later.
    }

    const updateData: Record<string, unknown> = { integrations_enabled: newState };
    if (billingProviderValue !== undefined) updateData.billing_provider = billingProviderValue;
    const { error } = await supabase.from('organizations').update(updateData).eq('id', organization.id);
    if (error) {
      setIntegrationsEnabled(previousState);
      toast({
        title: 'Não foi possível alterar a integração',
        description: 'Tenta novamente. A definição anterior foi mantida.',
        variant: 'destructive',
      });
      return;
    }
    await refetchUserData();
  };


  const handleSaveWhatsApp = () => {
    updateOrganization.mutate({
      whatsapp_base_url: whatsappBaseUrl.trim() || null,
      whatsapp_instance: whatsappInstance.trim() || null,
      ...(whatsappApiKey.trim() ? { whatsapp_api_key: whatsappApiKey.trim() } : {}),
    });
  };

  const handleSaveBrevo = () => {
    updateOrganization.mutate({
      ...(brevoApiKey.trim() ? { brevo_api_key: brevoApiKey.trim() } : {}),
      brevo_sender_email: brevoSenderEmail.trim() || null,
    });
  };

  const handleSaveInvoiceXpress = () => {
    updateOrganization.mutate({
      invoicexpress_account_name: invoiceXpressAccountName.trim() || null,
      ...(invoiceXpressApiKey.trim() ? { invoicexpress_api_key: invoiceXpressApiKey.trim() } : {}),
    });
  };

  const handleVendusApiKeyChange = (value: string) => {
    vendusLookupSequence.current += 1;
    setVendusApiKey(value);
    setVendusOptionsLoaded(false);
    setVendusRegisterReady(false);
    setVendusReadinessError('');
    setVendusOptionsLoading(false);
  };

  const handleLoadVendusOptions = async () => {
    if (!organization?.id || (!vendusApiKey.trim() && !chavesGuardadas.vendus)) {
      toast({ title: 'Introduz a chave API Vendus', variant: 'destructive' });
      return;
    }
    const requestId = ++vendusLookupSequence.current;
    setVendusOptionsLoading(true);
    setVendusOptionsLoaded(false);
    try {
      const { data, error } = await supabase.functions.invoke<VendusOptionsResponse>('vendus-options', {
        body: {
          organization_id: organization.id,
          ...(vendusApiKey.trim() ? { api_key: vendusApiKey.trim() } : {}),
        },
      });
      if (requestId !== vendusLookupSequence.current) return;
      if (error || !data || !Array.isArray(data.registers) || !Array.isArray(data.payment_methods)) {
        throw new Error('Não foi possível validar a chave Vendus.');
      }
      setVendusOptionsLoaded(true);
      setVendusRegisterReady(data.register_ready === true);
      setVendusReadinessError(data.readiness_error || '');
      toast({
        title: 'Chave Vendus validada',
        description: data.register_ready === true
          ? 'A caixa API está pronta. O método de pagamento vem de cada venda.'
          : data.readiness_error || 'A Vendus ainda não tem uma caixa API pronta para faturação.',
        variant: data.register_ready === true ? 'default' : 'destructive',
      });
    } catch {
      if (requestId === vendusLookupSequence.current) {
        toast({ title: 'Falha na ligação Vendus',
          description: 'Confirma a chave API e as permissões do utilizador na Vendus.',
          variant: 'destructive' });
      }
    } finally {
      if (requestId === vendusLookupSequence.current) setVendusOptionsLoading(false);
    }
  };

  const handleSaveVendus = () => {
    const apiKey = vendusApiKey.trim();
    if ((!apiKey && !chavesGuardadas.vendus) || !vendusOptionsLoaded) {
      toast({
        title: 'Dados Vendus incompletos',
        description: 'Valida a chave API antes de guardar.',
        variant: 'destructive',
      });
      return;
    }
    const settings = {
      ...(apiKey ? { vendus_api_key: apiKey } : {}),
      vendus_register_id: null,
      vendus_payment_method_id: null,
    } as unknown as Parameters<typeof updateOrganization.mutate>[0];
    updateOrganization.mutate(settings, {
      onSuccess: () => {
        if (apiKey) setChavesGuardadas((current) => ({ ...current, vendus: true }));
        setVendusApiKey('');
        setShowVendusApiKey(false);
      },
    });
  };

  const handleSaveKeyInvoice = async () => {
    const customUrl = keyinvoiceApiUrl.trim();
    if (customUrl) {
      try {
        const parsed = new URL(customUrl);
        if (
          parsed.protocol !== 'https:'
          || !!parsed.username
          || !!parsed.password
          || !!parsed.search
          || !!parsed.hash
          || (!!parsed.port && parsed.port !== '443')
          || parsed.pathname !== '/API5.php'
        ) {
          throw new Error('Formato de endpoint inválido');
        }
      } catch {
        toast({
          title: 'URL inválido',
          description: 'Usa um endpoint HTTPS no formato https://servidor/API5.php, sem parâmetros nem credenciais no endereço.',
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      await updateOrganization.mutateAsync({
        ...(keyinvoiceApiKey.trim() ? { keyinvoice_password: keyinvoiceApiKey.trim() } : {}),
        keyinvoice_api_url: customUrl || null,
      });
      if (keyinvoiceApiKey.trim()) {
        setChavesGuardadas((current) => ({ ...current, keyinvoice: true }));
        setKeyinvoiceApiKey('');
        setShowKeyinvoiceApiKey(false);
      }

    } catch {
      // useUpdateOrganization already reports the credential error.
    }
  };

  const handleSaveFiscal = async () => {
    const organizationId = organization?.id;
    if (!organizationId || isSavingFiscal) return;

    const taxValue = Number(taxRate);
    const taxName = taxValue === 0 ? 'Isento' : `IVA${taxValue}`;
    let taxConfigSaved = false;
    setIsSavingFiscal(true);

    try {
      await updateFiscalOrganization.mutateAsync({
        tax_config: {
          tax_name: taxName,
          tax_value: taxValue,
          tax_exemption_reason: taxValue === 0 ? taxExemptionReason : null,
        },
      });
      taxConfigSaved = true;

      const { data: activeMappings, error: mappingsError } = await supabase
        .from('stripe_product_mappings')
        .select('product_id')
        .eq('organization_id', organizationId)
        .eq('active', true);
      if (mappingsError) {
        throw new Error('não foi possível consultar os produtos ligados ao Stripe');
      }

      const mappedProductIds = [...new Set((activeMappings ?? []).map((mapping) => mapping.product_id))];
      if (mappedProductIds.length === 0) {
        toast({
          title: 'Configuração fiscal guardada',
          description: 'A taxa foi atualizada. Não existem produtos ativos ligados ao Stripe.',
        });
        return;
      }

      const { data: inheritedProducts, error: productsError } = await supabase
        .from('products')
        .select('id, name')
        .eq('organization_id', organizationId)
        .in('id', mappedProductIds)
        .is('tax_value', null);
      if (productsError) {
        throw new Error('não foi possível identificar os produtos que herdam a taxa global');
      }

      if (!inheritedProducts?.length) {
        toast({
          title: 'Configuração fiscal guardada',
          description: 'A taxa foi atualizada. Nenhum produto ativo no Stripe herda a taxa global.',
        });
        return;
      }

      const syncResults = await Promise.allSettled(
        inheritedProducts.map(async (product) => {
          const { data, error } = await supabase.functions.invoke<{ error?: string }>('stripe-product-sync', {
            body: { productId: product.id, action: 'sync' },
          });
          if (error || data?.error) {
            throw new Error(data?.error || error?.message || 'erro desconhecido');
          }
        }),
      );

      void queryClient.invalidateQueries({ queryKey: ['stripe-product-mappings', organizationId] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });

      const failures = syncResults.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [];
        const reason = result.reason instanceof Error ? result.reason.message : 'erro desconhecido';
        return [{ name: inheritedProducts[index].name, reason }];
      });

      if (failures.length > 0) {
        const details = failures
          .slice(0, 3)
          .map((failure) => `${failure.name}: ${failure.reason}`)
          .join(' · ');
        const remaining = failures.length > 3 ? ` · Mais ${failures.length - 3} produto(s) com erro.` : '';
        toast({
          title: 'Configuração guardada; sincronização incompleta',
          description: `A taxa ficou guardada, mas ${failures.length} de ${inheritedProducts.length} produto(s) não foram atualizados no Stripe. ${details}${remaining}`,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Configuração fiscal guardada',
        description: inheritedProducts.length === 1
          ? 'A taxa foi atualizada e o produto que a herda foi ressincronizado no Stripe.'
          : `A taxa foi atualizada e ${inheritedProducts.length} produtos que a herdam foram ressincronizados no Stripe.`,
      });
    } catch (error) {
      if (!taxConfigSaved) return;
      const reason = error instanceof Error ? error.message : 'ocorreu um erro inesperado';
      toast({
        title: 'Configuração fiscal guardada',
        description: `A taxa ficou guardada, mas ${reason}. Tenta guardar novamente para repetir a sincronização.`,
        variant: 'destructive',
      });
    } finally {
      setIsSavingFiscal(false);
    }
  };

  const handleSaveOrgName = () => {
    if (!orgName.trim()) {
      toast({ title: 'Nome inválido', description: 'O nome da organização não pode estar vazio.', variant: 'destructive' });
      return;
    }
    updateOrganization.mutate({ name: orgName.trim() });
  };

  const handleSaveProfile = () => {
    if (!fullName.trim()) {
      toast({ title: 'Nome inválido', description: 'O nome não pode estar vazio.', variant: 'destructive' });
      return;
    }
    updateProfile.mutate({ full_name: fullName.trim(), email: profileEmail, phone: profilePhone, email_signature: emailSignature, brevo_sender_email: profileBrevoSenderEmail });
  };

  const handleChangePassword = () => {
    if (!newPassword || !confirmPassword) {
      toast({ title: 'Campos em falta', description: 'Preencha ambos os campos de password.', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: 'Password muito curta', description: 'A password deve ter pelo menos 6 caracteres.', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords não coincidem', description: 'As passwords introduzidas não são iguais.', variant: 'destructive' });
      return;
    }
    changePassword.mutate({ newPassword }, {
      onSuccess: () => { setNewPassword(''); setConfirmPassword(''); setShowPassword(false); }
    });
  };

  // Shared props — split between the personal profile and the org identity
  // (the former GeneralContent was a single component mixing both audiences).
  const profileContentProps = {
    profile, fullName, setFullName,
    profileEmail, setProfileEmail, profilePhone, setProfilePhone,
    handleSaveProfile,
    updateProfileIsPending: updateProfile.isPending,
  };

  const companyContentProps = {
    organization, isAdmin, orgName, setOrgName, handleSaveOrgName,
    updateOrganizationIsPending: updateOrganization.isPending,
  };

  const integrationsContentProps = {
    chavesGuardadas,
    isLoadingIntegrations,
    updateOrganizationIsPending: updateOrganization.isPending,
    whatsappBaseUrl, setWhatsappBaseUrl, whatsappInstance, setWhatsappInstance,
    whatsappApiKey, setWhatsappApiKey, showWhatsappApiKey, setShowWhatsappApiKey,
    handleSaveWhatsApp, brevoApiKey, setBrevoApiKey, brevoSenderEmail, setBrevoSenderEmail,
    showBrevoApiKey, setShowBrevoApiKey, handleSaveBrevo,
    invoiceXpressAccountName, setInvoiceXpressAccountName,
    invoiceXpressApiKey, setInvoiceXpressApiKey,
    showInvoiceXpressApiKey, setShowInvoiceXpressApiKey,
    handleSaveInvoiceXpress,
    vendusApiKey, setVendusApiKey: handleVendusApiKeyChange, showVendusApiKey, setShowVendusApiKey,
    vendusOptionsLoaded, vendusRegisterReady, vendusReadinessError, vendusOptionsLoading,
    handleLoadVendusOptions, handleSaveVendus,
    integrationsEnabled, onToggleIntegration: handleToggleIntegration,
    handleSaveKeyInvoice, keyinvoiceApiKey, setKeyinvoiceApiKey,
    showKeyinvoiceApiKey, setShowKeyinvoiceApiKey, keyinvoiceApiUrl, setKeyinvoiceApiUrl,
    // Personal email-sending config (Brevo sender + signature), moved into the
    // Brevo integration screen. Saved via handleSaveProfile.
    profileSenderEmail: profileBrevoSenderEmail, setProfileSenderEmail: setProfileBrevoSenderEmail,
    emailSignature, setEmailSignature,
    handleSaveProfile,
    updateProfileIsPending: updateProfile.isPending,
  };

  // Render individual sub-section content
  const renderSubContent = (sub: SettingsSubSection) => {
    switch (sub) {
      // A Minha Conta
      case "account-profile": return <ProfileContent {...profileContentProps} />;
      case "account-security": return (
        <SecuritySettings
          newPassword={newPassword} setNewPassword={setNewPassword}
          confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
          showPassword={showPassword} setShowPassword={setShowPassword}
          handleChangePassword={handleChangePassword}
          changePasswordIsPending={changePassword.isPending}
        />
      );
      case "account-company": return <CompanyContent {...companyContentProps} />;
      case "account-plan": return <BillingTab />;
      case "account-referrals": return <ReferralProgram />;
      case "account-support": return <SupportTicketsTab />;

      // Módulos e Campos
      case "modules-list": return <ModulesTab />;
      case "modules-fields": return <FieldsManagerTabs />;
      case "modules-documents": return <ClientDocumentTypesSettings />;

      // Formulários de Captação
      case "capture-forms": return <FormsManager />;

      // Vendas e Comissões
      case "sales-pipeline": return <PipelineEditor />;
      case "sales-rules": return <SalesSettingsTab />;
      case "sales-commissions": return <CommissionMatrixTab />;
      case "sales-operators": return <OperatorsTab />;
      case "sales-products": return <ProductsTab />;

      // Equipa e Acessos
      case "team-access": return <TeamTab />;
      case "team-profiles": return <ProfilesTab />;
      case "team-teams": return <TeamsSection />;

      // Integrações (WhatsApp, email, webhooks e faturação eletrónica)
      case "integrations-connect": return <IntegrationsContent {...integrationsContentProps} />;

      // Financeiro
      case "finance-fiscal": return (
        <FiscalSettingsTab
          taxRate={taxRate}
          setTaxRate={setTaxRate}
          taxExemptionReason={taxExemptionReason}
          setTaxExemptionReason={setTaxExemptionReason}
          onSave={handleSaveFiscal}
          isPending={isSavingFiscal}
        />
      );
      case "finance-expenses": return <ExpenseCategoriesTab />;

      // Notificações e Alertas
      case "alerts-push": return <PushNotificationsCard organizationId={organization?.id} pushNotifications={pushNotifications} />;
      case "alerts-calendar": return <CalendarAlertsSettings />;
      case "alerts-email": return <NotificationEmailSettings />;
      case "alerts-fidelization": return <FidelizationAlertsSettings />;

      default: return null;
    }
  };

  // Select a group and jump straight to its first visible tab (2-level nav).
  const handleGroupSelect = (group: SettingsSection) => {
    setActiveGroup(group);
    const subs = getVisibleSubSections(group, subOpts);
    setActiveSub(subs[0]?.id ?? null);
  };

  // Back navigation always returns to the group grid (no intermediate level).
  const handleBack = () => {
    setActiveGroup(null);
    setActiveSub(null);
  };

  const groupSubs = activeGroup ? getVisibleSubSections(activeGroup, subOpts) : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
        {activeGroup === null ? (
          // Level 1: Group cards grid
          <>
            <PageHeader icon={SettingsIcon} title="Definições" subtitle="Configure a sua organização e integrações." />
            <MobileSettingsNav
              activeSection={null}
              onSelectSection={handleGroupSelect}
              canManageTeam={canManageTeam}
              canManageIntegrations={canManageIntegrations}
              isTelecom={isTelecom}
            />
          </>
        ) : (
          // Level 2: Tabs + content
          <>
            <div className="flex items-center gap-3 mb-4">
              <Button variant="ghost" size="icon" onClick={handleBack} className="shrink-0">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-lg font-semibold text-foreground">{sectionTitles[activeGroup]}</h1>
            </div>

            {groupSubs.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-2 mb-6 border-b border-border" style={{ WebkitOverflowScrolling: 'touch' }}>
                {groupSubs.map((sub) => {
                  const Icon = sub.icon;
                  const active = activeSub === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setActiveSub(sub.id)}
                      className={cn(
                        "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors shrink-0",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {sub.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div>
              {activeSub ? renderSubContent(activeSub) : (
                <p className="text-muted-foreground">Sem opções disponíveis nesta secção.</p>
              )}
            </div>
          </>
        )}
    </div>
  );
}
