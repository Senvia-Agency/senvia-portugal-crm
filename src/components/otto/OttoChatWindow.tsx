import { selectOttoFiles } from '@/lib/otto-attachments';
import { useState, useRef, useEffect } from "react";
import { X, ArrowUp, Square, Trash2, LifeBuoy, Paperclip, FileText, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOttoChat } from "@/hooks/useOttoChat";
import { OttoMessageComponent } from "./OttoMessage";
import { OttoActionCard } from "./OttoActionCard";
import { OttoQuickActions } from "./OttoQuickActions";
import { OttoOnboardingKickoff } from "./OttoOnboardingKickoff";
import { OttoAvatar } from "./OttoAvatar";
import { useOttoOnboarding } from "@/hooks/useOttoOnboarding";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useOttoStore } from "@/stores/useOttoStore";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";
import { cn } from "@/lib/utils";

interface OttoChatWindowProps {
  onClose: () => void;
}

function AttachmentThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const preview = URL.createObjectURL(file); setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return url ? <img src={url} alt={file.name} className="h-8 w-8 rounded-md object-cover" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

/**
 * Otto's side panel: full height on the right, beside the work instead of over
 * it, with a button to take the whole screen. On a phone it is the whole screen.
 * Only the presentation lives here — sending, streaming and attachments are
 * useOttoChat's, unchanged.
 */
export function OttoChatWindow({ onClose }: OttoChatWindowProps) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const {
    messages, isLoading, pendingAction, actionResult, actionDecision,
    sendMessage, confirmAction, cancelAction, clearMessages, cancelStream,
  } = useOttoChat();
  const { pendingAttachments, addAttachment, removeAttachment } = useOttoStore();
  const { showBadge: onboardingPending } = useOttoOnboarding();
  const [input, setInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const [expandedPref, setExpanded] = usePersistedState<boolean>("otto-expanded-v1", false);
  const dragDepth = useRef(0);
  const isMobile = useIsMobile();
  const expanded = !isMobile && expandedPref;
  // Keep the chat sized to the VISIBLE viewport so the input never hides behind
  // the on-screen keyboard (same approach as the inbox). iOS: position with CSS
  // top/height, never a transform.
  const { height: vvHeight, offsetTop: vvOffsetTop } = useVisualViewport();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstName = profile?.full_name?.trim().split(/\s+/)[0];
  const waitingFirstWord = isLoading && messages[messages.length - 1]?.role === "user";

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
      setTimeout(() => {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      }, 50);
    }
  }, [messages, isLoading, pendingAction, actionResult]);

  useEffect(() => {
    if (!isLoading) inputRef.current?.focus();
  }, [isLoading]);

  // Esc closes the panel, unless a menu or dialog inside it is handling the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Grows the box as the line wraps, instead of scrolling the text sideways
  // inside a fixed-height field. Capped by max-h-40 below.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const handleSend = () => {
    const text = input.trim();
    if ((!text && !pendingAttachments.length) || isLoading) return;
    setInput("");
    sendMessage(text);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleQuickAction = (text: string) => {
    if (isLoading) return;
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const attachFiles = (files: File[]) => {
    if (isLoading) return;
    const result = selectOttoFiles(useOttoStore.getState().pendingAttachments, files);
    result.errors.forEach(message => toast.error(message));
    result.files.forEach(addAttachment);
  };
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    attachFiles(Array.from(event.target.files || [])); event.target.value = '';
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return; // ordinary text keeps its normal caret/selection behavior
    event.preventDefault();
    attachFiles(files);
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      const field = event.currentTarget;
      setInput(previous => previous.slice(0, field.selectionStart) + text + previous.slice(field.selectionEnd));
    }
  };

  const openTicket = () => handleQuickAction(t("Preciso de abrir um ticket de suporte"));
  const canSend = (!!input.trim() || pendingAttachments.length > 0) && !isLoading;

  return (
    <motion.aside
      role="dialog"
      aria-label={t("Otto, assistente Senvia OS")}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = isLoading ? 'none' : 'copy';
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        attachFiles(Array.from(event.dataTransfer.files));
      }}
      // Never a vertical offset: useIsMobile starts as "mobile" and flips to
      // desktop right after mounting, which left the panel 24 px low (a gap on
      // top, the composer cut off). Desktop slides in sideways; a phone fades.
      initial={{ opacity: 0, x: isMobile ? 0 : 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: isMobile ? 0 : 32 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={isMobile ? { pointerEvents: 'auto', top: vvOffsetTop, height: vvHeight } : { pointerEvents: 'auto' }}
      className={cn(
        "fixed z-[9999] flex flex-col overflow-hidden bg-background",
        isMobile
          ? "left-0 right-0"
          : expanded
            ? "inset-0"
            : "bottom-0 right-0 top-0 w-[440px] max-w-[100vw] border-l border-border shadow-[-12px_0_40px_-12px_rgba(15,23,42,0.25)]",
      )}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/95 p-6 text-center" role="status">
          <span className="font-medium">{isLoading ? t('Aguarde pela resposta antes de anexar.') : t('Largue os ficheiros para os anexar à mensagem')}</span>
        </div>
      )}

      {/* Header */}
      <header
        className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3"
        style={isMobile ? { paddingTop: 'calc(clamp(20px, env(safe-area-inset-top, 0px), 50px) + 0.75rem)' } : undefined}
      >
        <OttoAvatar expression={isLoading ? "listening" : "neutral"} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-tight">Otto</h2>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <span className={cn("h-1.5 w-1.5 rounded-full", isLoading ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />
            {isLoading ? t("A pensar…") : t("Assistente Senvia OS")}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {messages.length > 0 && (
            <Button variant="ghost" size="icon-sm" onClick={openTicket} disabled={isLoading} title={t("Abrir ticket de suporte")} aria-label={t("Abrir ticket de suporte")}>
              <LifeBuoy className="h-4 w-4" />
            </Button>
          )}
          {messages.length > 0 && (
            <Button variant="ghost" size="icon-sm" onClick={clearMessages} disabled={isLoading} title={t("Limpar conversa")} aria-label={t("Limpar conversa")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {!isMobile && (
            <Button variant="ghost" size="icon-sm" onClick={() => setExpanded(!expandedPref)}
              title={expanded ? t("Reduzir") : t("Expandir")} aria-label={expanded ? t("Reduzir") : t("Expandir")}>
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} title={t("Fechar")} aria-label={t("Fechar")}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Conversation */}
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        <div className={cn("mx-auto w-full space-y-5 px-4 py-5", expanded && "max-w-3xl px-6")}>
          {messages.length === 0 && (
            onboardingPending ? (
              <OttoOnboardingKickoff />
            ) : (
              <div className="space-y-6 pt-2">
                <div className="flex flex-col items-center gap-3 text-center">
                  <OttoAvatar expression="happy" size="lg" />
                  <div>
                    <p className="text-lg font-semibold">{firstName ? t("Olá, {{name}}!", { name: firstName }) : t("Olá!")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t("Sou o Otto. Em que posso ajudar hoje?")}</p>
                  </div>
                </div>
                <OttoQuickActions onSelect={handleQuickAction} />
                <button type="button" onClick={openTicket} disabled={isLoading}
                  className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border px-3.5 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted"><LifeBuoy className="h-4 w-4 text-muted-foreground" /></span>
                  <span className="min-w-0">
                    <span className="block font-medium">{t("Abrir ticket de suporte")}</span>
                    <span className="block text-xs text-muted-foreground">{t("Fale com a equipa Senvia.")}</span>
                  </span>
                </button>
              </div>
            )
          )}
          {messages.map((msg, i) => (
            <OttoMessageComponent
              key={i}
              message={msg}
              onButtonClick={handleQuickAction}
              onLinkClick={onClose}
              isStreaming={isLoading && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}
          {pendingAction && (
            <OttoActionCard
              kind="preview"
              action={pendingAction}
              decision={actionDecision}
              onConfirm={confirmAction}
              onCancel={cancelAction}
            />
          )}
          {actionResult && (
            <OttoActionCard kind="result" result={actionResult} onOpenResource={onClose} />
          )}
          {waitingFirstWord && (
            <div className="flex items-center gap-2.5" role="status" aria-label={t("A pensar…")}>
              <OttoAvatar expression="listening" size="sm" />
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/40" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/40" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/40" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Composer */}
      <div className="shrink-0 px-3 pb-3 pt-1" style={isMobile ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' } : undefined}>
        <div className={cn(
          "mx-auto w-full rounded-2xl border border-border bg-background shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-md",
          expanded && "max-w-3xl",
        )}>
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {pendingAttachments.map((file, i) => (
                <div key={i} className="flex max-w-[180px] items-center gap-1.5 rounded-lg bg-muted py-1 pl-1 pr-2 text-xs">
                  <AttachmentThumbnail file={file} />
                  <span className="flex-1 truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={t("Remover {{name}}", { name: file.name })}
                    disabled={isLoading}
                    onClick={() => removeAttachment(i)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            aria-label={t("Mensagem para o Otto")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("Pergunte ao Otto…")}
            disabled={isLoading}
            rows={1}
            style={isMobile ? { fontSize: 16 } : undefined}
            className="block max-h-40 min-h-11 w-full resize-none overflow-y-auto bg-transparent px-3.5 pb-1 pt-3 text-sm leading-snug placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.csv,.md,.json"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-lg text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title={t("Anexar ficheiro")}
              aria-label={t("Anexar ficheiro")}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            {!isMobile && <span className="flex-1 truncate text-[11px] text-muted-foreground">{t("Enter para enviar · Shift+Enter para mudar de linha")}</span>}
            {isMobile && <span className="flex-1" />}
            {isLoading ? (
              <Button size="icon-sm" variant="secondary" className="rounded-lg" onClick={cancelStream} title={t("Parar resposta")} aria-label={t("Parar resposta")}>
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button size="icon-sm" className="rounded-lg" onClick={handleSend} disabled={!canSend} title={t("Enviar mensagem")} aria-label={t("Enviar mensagem")}>
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
