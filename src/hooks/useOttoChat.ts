import { useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useOttoStore } from "@/stores/useOttoStore";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildOttoHistory, ottoSubmission } from '@/lib/paid-client-input';

export type { OttoMessage } from "@/stores/useOttoStore";

// Otto 2.0 backend. The legacy `otto-chat` function is kept deployed as a
// fallback; this branch points at the new modular `otto` function.
const OTTO_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/otto`;

export function useOttoChat() {
  const { messages, isLoading, pendingAttachments, addMessage, updateLastMessage, clearMessages, setLoading, clearAttachments } = useOttoStore();
  const { session, organization } = useAuth();
  useEffect(() => { useOttoStore.getState().setScope(session?.user.id && organization?.id ? session.user.id + ':' + organization.id : null); }, [session?.user.id, organization?.id]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, [organization?.id, session?.user.id]);

  const uploadAttachments = useCallback(async (files: File[]): Promise<string[]> => {
    if (!files.length || !organization?.id) return [];
    const paths: string[] = [];
    for (const file of files) {
      const timestamp = crypto.randomUUID();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
      const path = `${organization.id}/${timestamp}_${safeName}`;
      const { error } = await supabase.storage
        .from("support-attachments")
        .upload(path, file, { upsert: false });
      if (error) {
        console.error("Upload error:", error);
        throw new Error(`Não consegui carregar ${file.name}. Os anexos foram mantidos para tentares novamente.`);
      } else {
        paths.push(path);
      }
    }
    return paths;
  }, [organization]);

  const sendMessage = useCallback(async (input: string, attachments?: File[]) => {
    if (useOttoStore.getState().isLoading) return;
    const filesToUpload = attachments || pendingAttachments;
    if (filesToUpload.reduce((total, file) => total + file.size, 0) > 12 * 1024 * 1024) { toast.error('Máximo de 12 MB no total.'); return; }
    input = input.trim() || (filesToUpload.length ? 'Analisa os anexos e ajuda-me a resolver o problema apresentado.' : '');
    const parsed = ottoSubmission.safeParse({ input, attachmentCount: filesToUpload.length });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message || 'Pedido inválido.'); return; }
    if (!organization?.id || !session?.access_token) { toast.error('Inicie sessão e selecione uma organização.'); return; }
    const userMsg = { role: "user" as const, content: parsed.data.input };

    setLoading(true);

    const allMessages = buildOttoHistory(messages, parsed.data.input);
    let assistantSoFar = "";

    let attachmentPaths: string[] = [];
    const requestScope = useOttoStore.getState().scope;
    const upsert = (chunk: string) => {
      if (useOttoStore.getState().scope !== requestScope) return;
      assistantSoFar += chunk;
      updateLastMessage(assistantSoFar);
    };

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      attachmentPaths = filesToUpload.length ? await uploadAttachments(filesToUpload)
        : [...messages].reverse().find(message => message.attachmentPaths?.length)?.attachmentPaths || [];
      if (controller.signal.aborted || useOttoStore.getState().scope !== requestScope) return;
      addMessage({ ...userMsg, attachmentPaths });

      const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const resp = await fetch(OTTO_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: allMessages,
          organization_id: organization?.id || null,
          attachment_paths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Erro desconhecido" }));
        toast.error(err.error || "Erro ao contactar o Otto");
        setLoading(false);
        return;
      }

      if (controller.signal.aborted || useOttoStore.getState().scope !== requestScope) return;
      clearAttachments();
      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            done = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsert(content);
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      if (buffer.trim()) {
        for (let raw of buffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsert(content);
          } catch { /* ignore */ }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.error("Otto error:", e);
        toast.error(e.message || "Erro ao comunicar com o Otto");
      }
    } finally {
      if (useOttoStore.getState().scope === requestScope) setLoading(false);
      abortRef.current = null;
    }
  }, [messages, addMessage, updateLastMessage, setLoading, session, organization, pendingAttachments, uploadAttachments, clearAttachments]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isLoading, sendMessage, clearMessages, cancelStream };
}
