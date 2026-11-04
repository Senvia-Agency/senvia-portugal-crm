import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isActiveMember, useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useModules, type EnabledModules } from "@/hooks/useModules";
import { usePersistedState } from "@/hooks/usePersistedState";
import { MESSAGING_CHANNELS_ENABLED } from "@/lib/constants";

// A single setup task Otto guides. `module` gates it to an enabled module (null =
// always relevant). `kind`/`target` describe the action (see runSetupTask).
export interface OttoSetupTask {
  key: string;
  label: string;
  description: string;
  icon: "kanban" | "message" | "receipt" | "mail" | "bag" | "users" | "upload";
  module: keyof EnabledModules | null;
  done: boolean;
  kind: "tour" | "modal" | "chat" | "nav";
  target: string;
  /**
   * Shown and counted, but does not hold `completed` back. Only for tasks the
   * admin cannot finish alone — otherwise a one-person business would never
   * reach "configurado" and the setup card would never go away.
   */
  optional?: boolean;
}

export interface OttoOnboardingStatus {
  loading: boolean;
  tasks: OttoSetupTask[];      // tasks for the org's ACTIVE modules
  steps: OttoSetupTask[];      // alias of tasks (back-compat for the progress panel)
  pending: OttoSetupTask[];    // tasks not yet done
  completed: boolean;          // every non-optional active-module task is configured
  dismissed: boolean;          // admin explicitly closed the dashboard setup card
  showBadge: boolean;          // admin + something still pending (drives chat kickoff + progress panel)
  showSetupCard: boolean;      // admin + still something to configure + not dismissed
  dismissSetup: () => void;    // close the dashboard setup card (persisted per org, server-side)
  progress: { done: number; total: number };
}

export function useOttoOnboarding(): OttoOnboardingStatus {
  const { organization, organizations } = useAuth();
  const { isAdmin } = usePermissions();
  const { modules } = useModules();
  const orgId = organization?.id;

  const queryClient = useQueryClient();

  // Dashboard setup card dismissal. The localStorage map is the instant local
  // mirror (stable key indexed by orgId, so it rehydrates once the org loads);
  // org_onboarding_state.dismissed is the real record, so closing the card on
  // one device also closes it on the next — before, it was localStorage only
  // and came back on every other browser, which read as "o botão não faz nada".
  const [dismissedMap, setDismissedMap] = usePersistedState<Record<string, boolean>>("otto-setup-dismissed-v1", {});

  const { data: serverDismissed } = useQuery({
    queryKey: ["otto-setup-dismissed", orgId],
    enabled: !!orgId,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("org_onboarding_state")
        .select("dismissed")
        .eq("organization_id", orgId!)
        .maybeSingle();
      if (error) throw error;
      return !!data?.dismissed;
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) return;
      const { error } = await (supabase as any)
        .from("org_onboarding_state")
        .upsert(
          { organization_id: orgId, dismissed: true, updated_at: new Date().toISOString() },
          { onConflict: "organization_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["otto-setup-dismissed", orgId] }),
    onError: (error) => {
      // Never silent: the local mirror already hid the card, but a failed write
      // means it returns for this admin on another device.
      console.error("[otto] failed to persist setup dismissal", error);
    },
  });

  // Either source counts, so a failed/slow server read never resurrects the card.
  const dismissed = !!orgId && (!!dismissedMap[orgId] || !!serverDismissed);
  const dismissSetup = () => {
    if (!orgId) return;
    setDismissedMap((m) => ({ ...m, [orgId]: true }));
    // A super admin visiting an organization hides the card for themselves only:
    // the organization's own admins keep it until they close it.
    if (isActiveMember(organizations, orgId)) dismissMutation.mutate();
  };

  const { data, isLoading } = useQuery({
    queryKey: ["otto-setup", orgId],
    enabled: !!orgId,
    staleTime: 30_000,
    queryFn: async () => {
      const [stagesRes, leadsRes, membersRes, invitesRes, productsRes, channelsRes, orgRes, autoreplyRes] = await Promise.all([
        supabase.from("pipeline_stages").select("id", { count: "exact", head: true }).eq("organization_id", orgId!),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", orgId!),
        supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", orgId!).eq("is_active", true),
        supabase.from("organization_invites").select("id", { count: "exact", head: true }).eq("organization_id", orgId!),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", orgId!),
        supabase.from("messaging_channels").select("id", { count: "exact", head: true }).eq("organization_id", orgId!).eq("status", "connected"),
        supabase.from("organizations").select("tem_invoicexpress_api_key, keyinvoice_username, tem_brevo_api_key, billing_provider, whatsapp_instance, ai_response_mode, msg_template_hot, msg_template_warm, msg_template_cold").eq("id", orgId!).maybeSingle(),
        supabase.from("forms").select("id", { count: "exact", head: true }).eq("organization_id", orgId!).or("msg_template_hot.not.is.null,msg_template_warm.not.is.null,msg_template_cold.not.is.null"),
      ]);
      const org = orgRes.data as any;
      // Auto-reply lives in one of TWO places depending on the org's mode: per
      // form, or globally on the organization (FormsManager writes the global
      // templates onto organizations). Only the per-form table was checked, so
      // every org in 'global' mode read as unconfigured forever.
      const globalAutoreply = !!(org?.msg_template_hot || org?.msg_template_warm || org?.msg_template_cold);
      return {
        stages: stagesRes.count ?? 0,
        leads: leadsRes.count ?? 0,
        members: membersRes.count ?? 0,
        invites: invitesRes.count ?? 0,
        products: productsRes.count ?? 0,
        // A channel row is the modern signal; whatsapp_instance is the legacy
        // org-level one. useActivationProgress already accepts both.
        channels: (channelsRes.count ?? 0) > 0 || !!org?.whatsapp_instance ? 1 : 0,
        invoicing: !!(org?.billing_provider || org?.tem_invoicexpress_api_key || org?.keyinvoice_username),
        marketing: !!org?.tem_brevo_api_key,
        autoreply: (autoreplyRes.count ?? 0) > 0 || globalAutoreply,
      };
    },
  });

  const c = data ?? { stages: 0, leads: 0, members: 0, invites: 0, products: 0, channels: 0, invoicing: false, marketing: false, autoreply: false };

  // Every possible task; filtered below to the org's active modules.
  const all: OttoSetupTask[] = [
    { key: "pipeline", label: "Configurar o pipeline de vendas", description: "As etapas por onde passam os teus negócios.", icon: "kanban", module: null, done: c.stages > 0, kind: "tour", target: "setup_pipeline" },
    { key: "inbox", label: "Ligar um canal de mensagens", description: "Liga o WhatsApp para falar com clientes dentro do CRM.", icon: "message", module: "inbox", done: c.channels > 0, kind: "modal", target: "whatsapp" },
    { key: "autoreply", label: "Ativar resposta automática a leads", description: "Cada lead recebe uma 1ª mensagem no WhatsApp em segundos, pela temperatura.", icon: "message", module: "inbox", done: c.autoreply, kind: "chat", target: "Quero configurar a resposta automática aos meus leads." },
    { key: "finance", label: "Configurar a faturação", description: "InvoiceXpress ou KeyInvoice para emitires faturas.", icon: "receipt", module: "finance", done: c.invoicing, kind: "chat", target: "Quero configurar a faturação da minha empresa." },
    { key: "marketing", label: "Ligar o email marketing", description: "Liga o Brevo para campanhas e emails automáticos.", icon: "mail", module: "marketing", done: c.marketing, kind: "chat", target: "Quero ligar o Brevo para email marketing." },
    { key: "ecommerce", label: "Adicionar o primeiro produto", description: "Cria o teu catálogo para começares a vender.", icon: "bag", module: "ecommerce", done: c.products > 0, kind: "nav", target: "/ecommerce/products" },
    // Optional: depends on another person accepting. Every organization in
    // production today has exactly one member, so as a required task it made
    // "configurado" unreachable for everyone. Sending an invite counts as done.
    { key: "team", label: "Convidar a equipa", description: "Dá acesso aos teus colegas e define permissões.", icon: "users", module: null, done: c.members > 1 || c.invites > 0, kind: "tour", target: "invite_member", optional: true },
    { key: "leads", label: "Importar os teus leads", description: "Traz os teus contactos para o CRM.", icon: "upload", module: null, done: c.leads > 0, kind: "tour", target: "import_leads" },
  ];

  // "inbox" points at connecting WhatsApp, which is paused (MESSAGING_CHANNELS
  // in constants.ts) — pointing an admin at a hidden connect flow is worse
  // than not showing the step. Comes back on its own once the pause lifts.
  const tasks = all
    .filter((t) => t.module === null || (modules as any)?.[t.module])
    .filter((t) => t.key !== "inbox" || MESSAGING_CHANNELS_ENABLED);
  const pending = tasks.filter((t) => !t.done);

  // Only the tasks the admin can actually finish alone decide "configurado".
  const required = tasks.filter((t) => !t.optional);
  const completed = required.length > 0 && required.every((t) => t.done);

  return {
    loading: isLoading,
    tasks,
    steps: tasks,
    pending,
    completed,
    dismissed,
    showBadge: !!orgId && isAdmin && !isLoading && pending.length > 0,
    // Hides once everything is set up, not only when closed by hand. It used to
    // omit `completed` on purpose ("stays until the admin closes it"), which is
    // exactly the reported complaint: a fully configured org saw it forever.
    showSetupCard: !!orgId && isAdmin && !isLoading && tasks.length > 0 && !completed && !dismissed,
    dismissSetup,
    progress: { done: tasks.length - pending.length, total: tasks.length },
  };
}
