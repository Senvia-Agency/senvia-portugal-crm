import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ExternalLink, MessageCircle, Sparkles, Paperclip, Copy, Check } from "lucide-react";
import { toast } from "sonner";
const ottoMascot = "/otto-mascot.svg";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import type { OttoMessage as OttoMessageType } from "@/hooks/useOttoChat";
import { useTourStore } from "@/stores/useTourStore";
import { useModalStore, type OttoManagedModal } from "@/stores/useModalStore";
import { useOttoStore } from "@/stores/useOttoStore";
import { getTour } from "./tours";
import { useLanguage } from "@/i18n";

// [tour:id] launches a deterministic guided tour. [modal:name] opens a managed modal.
function parseTours(content: string) {
  const re = /\[tour:(.+?)\]/g;
  const ids: string[] = [];
  let m;
  while ((m = re.exec(content)) !== null) ids.push(m[1].trim());
  return { cleanContent: content.replace(re, "").trim(), tourIds: ids };
}
function parseModals(content: string) {
  const re = /\[modal:(.+?)\]/g;
  const ids: string[] = [];
  let m;
  while ((m = re.exec(content)) !== null) ids.push(m[1].trim());
  return { cleanContent: content.replace(re, "").trim(), modalIds: ids };
}

// Friendly labels for the "open this form" button (defaults to "Abrir").
const MODAL_LABELS: Record<string, string> = {
  whatsapp: "Ligar WhatsApp",
  add_lead: "Criar lead",
  add_client: "Criar cliente",
  create_sale: "Registar venda",
  create_proposal: "Criar proposta",
};

interface OttoMessageProps {
  message: OttoMessageType;
  onButtonClick?: (text: string) => void;
  onLinkClick?: () => void;
  isStreaming?: boolean;
}

function parseButtons(content: string) {
  const buttonRegex = /\[botao:(.+?)\]/g;
  const buttons: string[] = [];
  let match;
  while ((match = buttonRegex.exec(content)) !== null) {
    buttons.push(match[1]);
  }
  const cleanContent = content.replace(buttonRegex, "").trim();
  return { cleanContent, buttons };
}

function parseLinks(content: string) {
  const linkRegex = /\[link:(.+?)\|(.+?)\]/g;
  const links: { label: string; path: string }[] = [];
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    links.push({ label: match[1], path: match[2] });
  }
  const cleanContent = content.replace(linkRegex, "").trim();
  return { cleanContent, links };
}

function parseWhatsAppLinks(content: string) {
  const regex = /\[whatsapp:(.+?)\|(.+?)\]/g;
  const waLinks: { label: string; url: string }[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    waLinks.push({ label: match[1], url: match[2] });
  }
  const cleanContent = content.replace(regex, "").trim();
  return { cleanContent, waLinks };
}

export function OttoMessageComponent({ message, onButtonClick, onLinkClick, isStreaming }: OttoMessageProps) {
  const { t } = useLanguage();
  const isUser = message.role === "user";
  const navigate = useNavigate();
  const startTour = useTourStore((s) => s.start);
  const openModal = useModalStore((s) => s.openModal);
  const setOttoOpen = useOttoStore((s) => s.setOpen);
  const [copied, setCopied] = useState(false);

  const parsed = isUser
    ? { cleanContent: message.content, buttons: [], links: [], waLinks: [], tourIds: [], modalIds: [] }
    : (() => {
        const { cleanContent: c1, buttons } = parseButtons(message.content);
        const { cleanContent: c2, links } = parseLinks(c1);
        const { cleanContent: c3, waLinks } = parseWhatsAppLinks(c2);
        const { cleanContent: c4, tourIds } = parseTours(c3);
        const { cleanContent: c5, modalIds } = parseModals(c4);
        return { cleanContent: c5, buttons, links, waLinks, tourIds, modalIds };
      })();

  const { cleanContent, buttons, links, waLinks, tourIds, modalIds } = parsed;

  // Launch a guided tour: close the chat so the spotlight over the real UI is visible.
  const launchTour = (id: string) => {
    setOttoOpen(false);
    startTour(id);
  };
  const launchModal = (id: string) => {
    setOttoOpen(false);
    openModal(id as Exclude<OttoManagedModal, null>);
  };

  // The person's message is a bubble on the right; Otto's answer reads as
  // full-width text, easier on long replies than a narrow grey bubble.
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1.5">
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
            {cleanContent}
          </div>
          {!!message.attachmentPaths?.length && (
            <p className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
              <Paperclip className="h-3 w-3" />
              {t("{{n}} anexo(s)", { n: message.attachmentPaths.length })}
            </p>
          )}
        </div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cleanContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("Não foi possível copiar."));
    }
  };

  return (
    <div className="group flex gap-2.5">
      <img src={ottoMascot} alt="" aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover" />

      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="text-sm leading-relaxed text-foreground">
          <div className="prose prose-sm dark:prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ol]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/60 align-middle" />
          )}
        </div>

        {/* Action buttons */}
        {buttons.length > 0 && !isStreaming && (
          <div className="flex flex-wrap gap-1.5">
            {buttons.map((btn, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                className="h-auto py-1.5 px-3 text-xs rounded-full whitespace-normal text-left"
                onClick={() => onButtonClick?.(btn)}
              >
                {btn}
              </Button>
            ))}
          </div>
        )}

        {/* Navigation links */}
        {links.length > 0 && !isStreaming && (
          <div className="flex flex-wrap gap-1.5">
            {links.map((link, i) => (
              <Button
                key={i}
                variant="default"
                size="sm"
                className="h-auto py-1.5 px-3 text-xs rounded-full whitespace-normal text-left gap-1.5"
                onClick={() => {
                  navigate(link.path);
                  onLinkClick?.();
                }}
              >
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                {link.label}
              </Button>
            ))}
          </div>
        )}

        {/* Guided tours + managed modals */}
        {!isStreaming && tourIds.map((id, i) => {
          const tour = getTour(id);
          if (!tour) return null;
          return (
            <Button
              key={`tour-${i}`}
              variant="default"
              size="sm"
              className="h-auto w-full justify-start gap-1.5 rounded-full py-1.5 px-3 text-xs"
              onClick={() => launchTour(id)}
            >
              <Sparkles className="h-3 w-3 flex-shrink-0" />
              {t("Mostra-me: {{title}}", { title: t(tour.title) })}
            </Button>
          );
        })}
        {!isStreaming && modalIds.map((id, i) => (
          <Button
            key={`modal-${i}`}
            variant="default"
            size="sm"
            className="h-auto w-full justify-start gap-1.5 rounded-full py-1.5 px-3 text-xs"
            onClick={() => launchModal(id)}
          >
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
            {t(MODAL_LABELS[id] || "Abrir")}
          </Button>
        ))}

        {/* WhatsApp links */}
        {waLinks.length > 0 && !isStreaming && (
          <div className="flex flex-col gap-2 w-full">
            {waLinks.map((wa, i) => (
              <a
                key={i}
                href={wa.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="w-full flex items-center gap-3 bg-[#25D366] hover:bg-[#1ebe5d] 
                  text-white rounded-xl p-3.5 transition-all duration-200 
                  hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="font-semibold text-sm">{wa.label}</p>
                  <p className="text-[11px] text-white/80">
                    {t("Toca para abrir o WhatsApp e enviar")}
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-white/60 flex-shrink-0" />
              </a>
            ))}
          </div>
        )}

        {!isStreaming && cleanContent && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t("Copiado") : t("Copiar")}
          </button>
        )}
      </div>
    </div>
  );
}
