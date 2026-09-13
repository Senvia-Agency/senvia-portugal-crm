import { selectOttoFiles } from '@/lib/otto-attachments';
import { useState, useRef, useEffect } from "react";
import { X, Send, Trash2, LifeBuoy, Paperclip, FileText, Image as ImageIcon } from "lucide-react";
const ottoMascot = "/otto-mascot.svg";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOttoChat } from "@/hooks/useOttoChat";
import { OttoMessageComponent } from "./OttoMessage";
import { OttoQuickActions } from "./OttoQuickActions";
import { OttoOnboardingKickoff } from "./OttoOnboardingKickoff";
import { useOttoOnboarding } from "@/hooks/useOttoOnboarding";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useOttoStore } from "@/stores/useOttoStore";
import { motion } from "framer-motion";
import { toast } from "sonner";

interface OttoChatWindowProps {
  onClose: () => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain", "text/csv", "text/markdown", "application/json"];

function AttachmentThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const preview = URL.createObjectURL(file); setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return url ? <img src={url} alt={file.name} className="h-10 w-10 rounded object-cover" /> : <FileText className="h-5 w-5 shrink-0" />;
}

export function OttoChatWindow({ onClose }: OttoChatWindowProps) {
  const { messages, isLoading, sendMessage, clearMessages } = useOttoChat();
  const { pendingAttachments, addAttachment, removeAttachment, clearAttachments } = useOttoStore();
  const { showBadge: onboardingPending } = useOttoOnboarding();
  const [input, setInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const isMobile = useIsMobile();
  // Keep the chat sized to the VISIBLE viewport so the input never hides behind
  // the on-screen keyboard (same approach as the inbox). iOS: position with CSS
  // top/height, never a transform.
  const { height: vvHeight, offsetTop: vvOffsetTop } = useVisualViewport();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    );
    if (viewport) {
      setTimeout(() => {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      }, 50);
    }
  }, [messages, isLoading]);

  const handleSend = () => {
    const text = input.trim();
    if ((!text && !pendingAttachments.length) || isLoading) return;
    setInput("");
    sendMessage(text);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  // Grows the box as the line wraps, instead of scrolling the text
  // sideways inside a fixed-height field. Capped by max-h-32 in the
  // className below — past that it scrolls internally like before.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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

  const getFileIcon = (file: File) => {
    if (file.type === "application/pdf") return <FileText className="w-3.5 h-3.5" />;
    return <ImageIcon className="w-3.5 h-3.5" />;
  };

  return (
    <motion.div
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
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      style={isMobile
        ? { pointerEvents: 'auto', top: vvOffsetTop, height: vvHeight }
        : { pointerEvents: 'auto' }}
      className={
        isMobile
          ? "fixed left-0 right-0 z-[9999] bg-background flex flex-col overflow-hidden"
          : "fixed bottom-20 right-4 z-[9999] w-[380px] h-[520px] bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      }
    >
      {dragging && <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/95 p-6 text-center" role="status">
        <span className="font-medium">{isLoading ? 'Aguarda pela resposta antes de anexar.' : 'Larga os ficheiros para anexar à mensagem'}</span>
      </div>}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30" style={isMobile ? { paddingTop: 'calc(clamp(20px, env(safe-area-inset-top, 0px), 50px) + 0.75rem)' } : undefined}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full overflow-hidden">
            <img src={ottoMascot} alt="Otto" className="w-full h-full object-cover" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Otto</h3>
            <p className="text-[10px] text-muted-foreground">Assistente Senvia OS</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button variant="ghost" size="icon-sm" onClick={clearMessages} title="Limpar conversa">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        <div className="p-4 space-y-4">
          {messages.length === 0 && (
            onboardingPending ? (
              <OttoOnboardingKickoff />
            ) : (
              <div className="flex gap-2.5">
                <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden">
                  <img src={ottoMascot} alt="Otto" className="w-full h-full object-cover" />
                </div>
                <div className="max-w-[85%]">
                  <OttoQuickActions onSelect={handleQuickAction} />
                </div>
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
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex gap-2.5">
              <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden">
                <img src={ottoMascot} alt="Otto" className="w-full h-full object-cover" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-md px-3.5 py-2.5">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border bg-muted/20" style={isMobile ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' } : undefined}>
        {!messages.some(m => m.role === "assistant" && /ticket|assunto|suporte/i.test(m.content)) && (
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-full gap-2 text-xs mb-2"
            onClick={() => handleQuickAction("Preciso de abrir um ticket de suporte")}
            disabled={isLoading}
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            Abrir Ticket de Suporte
          </Button>
        )}

        {/* Attachment previews */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {pendingAttachments.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-muted rounded-lg px-2 py-1 text-xs max-w-[160px]"
              >
                <AttachmentThumbnail file={file} />
                <span className="truncate flex-1">{file.name}</span>
                <button
                  aria-label={`Remover ${file.name}`}
                  disabled={isLoading}
                  onClick={() => removeAttachment(i)}
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Hidden file input */}
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
            size="icon"
            className="h-10 w-10 rounded-xl flex-shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title="Anexar ficheiro"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <textarea
            ref={inputRef}
            aria-label="Mensagem para o Otto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Escreve ou cola uma imagem..."
            disabled={isLoading}
            rows={1}
            style={isMobile ? { fontSize: 16 } : undefined}
            className="flex-1 min-h-10 max-h-32 py-2.5 px-3 rounded-xl bg-background border border-border text-sm leading-tight placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none overflow-y-auto"
          />
          <Button
            size="icon"
            className="h-10 w-10 rounded-xl flex-shrink-0"
            aria-label="Enviar mensagem"
            onClick={handleSend}
            disabled={(!input.trim() && !pendingAttachments.length) || isLoading}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
