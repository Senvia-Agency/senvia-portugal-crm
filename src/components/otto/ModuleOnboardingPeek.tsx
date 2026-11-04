import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { OttoAvatar } from "./OttoAvatar";
import { useOttoStore } from "@/stores/useOttoStore";
import { useOttoChat } from "@/hooks/useOttoChat";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePersistedState } from "@/hooks/usePersistedState";
import { cn } from "@/lib/utils";
import {
  useOnboardingPeek,
  type ActivationModuleKey,
} from "@/hooks/useActivationProgress";
import { useLanguage } from "@/i18n";
import { useSenvia2GuideCard } from "./Senvia2Guide";

// Per-module script: the short pitch shown in the bubble + the message sent to
// Otto when the user accepts help. No sample data: every path creates REAL data.
const SCRIPTS: Record<ActivationModuleKey, { title: string; body: string; seed: string }> = {
  leads: {
    title: "Vamos encher o teu pipeline?",
    body: "Aqui vivem as tuas leads. Posso ajudar-te a importar os teus contactos reais (Excel/CSV) ou a criar a primeira lead.",
    seed: "Ajuda-me a adicionar as minhas primeiras leads (importar do Excel/CSV ou criar uma).",
  },
  clients: {
    title: "Cria o teu primeiro cliente",
    body: "Aqui geres os teus clientes. Posso criar o primeiro contigo, ou converter uma lead que já tenhas.",
    seed: "Ajuda-me a criar o meu primeiro cliente.",
  },
  sales: {
    title: "Regista a tua primeira venda",
    body: "Este é o momento em que vês o dinheiro a entrar no Senvia OS. Queres registar a tua primeira venda agora?",
    seed: "Ajuda-me a registar a minha primeira venda.",
  },
  proposals: {
    title: "Cria a tua primeira proposta",
    body: "Aqui montas propostas para os teus clientes. Posso guiar-te a criar a primeira em poucos passos.",
    seed: "Ajuda-me a criar a minha primeira proposta.",
  },
  finance: {
    title: "Configura a faturação",
    body: "Aqui controlas faturas, despesas e comissões. Para emitires faturas, ligo a tua faturação (InvoiceXpress ou KeyInvoice). Queres configurar agora?",
    seed: "Quero configurar a faturação da minha empresa.",
  },
  integrations: {
    title: "Liga as tuas ferramentas",
    body: "Liga o email marketing (Brevo), o WhatsApp e outras integrações. Posso ajudar-te a ligar a primeira. Por onde queres começar?",
    seed: "Quero ligar as minhas integrações (Brevo, WhatsApp...).",
  },
  inbox: {
    title: "Liga o teu WhatsApp",
    body: "Aqui recebes e respondes a mensagens num só sítio. Mostro-te como ligar o WhatsApp (com leitura de QR no telemóvel).",
    seed: "Quero ligar o meu WhatsApp à caixa de entrada.",
  },
  team: {
    title: "Convida a tua equipa",
    body: "Aqui dás acesso aos teus colegas e defines as permissões de cada um. Queres convidar alguém agora?",
    seed: "Quero convidar um colega para a minha equipa.",
  },
};

// Single mount point (in AppLayout). Resolves the module from the current route
// and shows a soft, non-modal Otto bubble the first time the user lands on it,
// until they engage, complete it, or dismiss it. Never a blocking modal.
export function ModuleOnboardingPeek() {
  const { t } = useLanguage();
  const location = useLocation();
  const isMobile = useIsMobile();
  const ottoOpen = useOttoStore((s) => s.isOpen);
  const guideCard = useSenvia2GuideCard((s) => s.visible);
  const setOttoOpen = useOttoStore((s) => s.setOpen);
  const { sendMessage } = useOttoChat();

  const { moduleKey, shouldShow, dismiss } = useOnboardingPeek(location.pathname);
  // One switch for every module's bubble: each module has its own, and one at a
  // time quickly becomes nagging.
  const [peeksOff, setPeeksOff] = usePersistedState("otto-peeks-off-v1", false);

  // Hide while the chat is open (no point peeking over the open assistant).
  const visible = !!moduleKey && shouldShow && !ottoOpen && !peeksOff && !guideCard;
  const script = moduleKey ? SCRIPTS[moduleKey] : null;

  const handleAccept = () => {
    if (!script) return;
    setOttoOpen(true);
    sendMessage(t(script.seed));
  };

  return (
    <AnimatePresence mode="wait">
      {visible && script && (
        <motion.div
          key={moduleKey}
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{
            opacity: 1, y: 0, scale: 1,
            transition: { delay: 0.45, type: "spring", stiffness: 320, damping: 26 },
          }}
          exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.15 } }}
          className={cn(
            "fixed z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-card p-4 shadow-xl",
            isMobile ? "bottom-24 right-3" : "bottom-6 right-6",
          )}
          role="dialog"
          aria-label={t("Sugestão do Otto")}
        >
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("Dispensar")}
            className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex gap-3">
            <OttoAvatar expression="happy" size="sm" />
            <div className="min-w-0 flex-1 pr-4">
              <p className="text-sm font-semibold text-foreground">{t(script.title)}</p>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{t(script.body)}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPeeksOff(true)}
              className="mr-auto text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t("Não mostrar mais")}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              {t("Agora não")}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("Sim, ajuda-me")}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
