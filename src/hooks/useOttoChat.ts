import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { requestOttoStream, type OttoActionDecision } from "@/components/otto/ottoProtocol";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildOttoHistory, ottoSubmission } from "@/lib/paid-client-input";
import { useOttoStore, type OttoActionResult } from "@/stores/useOttoStore";

export type { OttoMessage } from "@/stores/useOttoStore";

// What Otto is doing belongs to the app, not to the component that asked:
// closing Otto's panel (or any caller unmounting) must not cut the reply off.
// Every useOttoChat shares this; only a change of account or organization
// (the scope) bumps the generation and aborts it.
const shared = {
  lifecycle: { current: 0 },
  stream: { current: null as AbortController | null },
  action: { current: null as AbortController | null },
  scope: undefined as string | null | undefined,
};

export function useOttoChat() {
  const {
    scope,
    messages,
    isLoading,
    pendingAttachments,
    pendingAction,
    actionResult,
    addMessage,
    updateLastMessage,
    clearMessages,
    setLoading,
    clearAttachments,
    setScope,
    setPendingAction,
    setActionResult,
  } = useOttoStore();
  const { session, organization } = useAuth();
  const queryClient = useQueryClient();
  const activeScope = session?.user.id && organization?.id
    ? `${session.user.id}:${organization.id}`
    : null;
  const lifecycleRef = shared.lifecycle;
  const streamAbortRef = shared.stream;
  const actionAbortRef = shared.action;
  const actionDecisionRef = useRef<OttoActionDecision | null>(null);
  const [actionDecision, setActionDecision] = useState<OttoActionDecision | null>(null);

  useEffect(() => {
    // Only a change of account or organization ends what Otto is doing. A
    // component that unmounts (the panel closing) leaves the reply running.
    if (shared.scope !== activeScope) {
      shared.scope = activeScope;
      lifecycleRef.current += 1;
      streamAbortRef.current?.abort();
      actionAbortRef.current?.abort();
      streamAbortRef.current = null;
      actionAbortRef.current = null;
    }
    actionDecisionRef.current = null;
    setActionDecision(null);
    setScope(activeScope);
  }, [activeScope, setScope, lifecycleRef, streamAbortRef, actionAbortRef]);

  const uploadAttachments = useCallback(async (files: readonly File[]): Promise<string[]> => {
    if (!organization?.id || files.length === 0) return [];
    const paths: string[] = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
      const path = `${organization.id}/${crypto.randomUUID()}_${safeName}`;
      const { error } = await supabase.storage.from("support-attachments").upload(path, file, { upsert: false });
      if (error) throw new Error(`Não consegui carregar ${file.name}. Os anexos foram mantidos para tentares novamente.`);
      paths.push(path);
    }
    return paths;
  }, [organization?.id]);

  const applyActionResult = useCallback((result: OttoActionResult, requestScope: string): void => {
    setActionResult(result, requestScope);
    if (result.status !== "succeeded") return;
    for (const queryKey of result.invalidateQueryKeys ?? []) {
      void queryClient.invalidateQueries({ queryKey: [...queryKey] });
    }
  }, [queryClient, setActionResult]);

  const sendMessage = useCallback(async (input: string, attachments?: readonly File[]) => {
    if (useOttoStore.getState().isLoading) return;
    const filesToUpload = attachments ?? pendingAttachments;
    if (filesToUpload.reduce((total, file) => total + file.size, 0) > 12 * 1024 * 1024) {
      toast.error("Máximo de 12 MB no total.");
      return;
    }
    const normalizedInput = input.trim()
      || (filesToUpload.length > 0 ? "Analisa os anexos e ajuda-me a resolver o problema apresentado." : "");
    const parsed = ottoSubmission.safeParse({ input: normalizedInput, attachmentCount: filesToUpload.length });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Pedido inválido.");
      return;
    }
    const accessToken = session?.access_token;
    const organizationId = organization?.id;
    const requestScope = useOttoStore.getState().scope;
    if (!accessToken || !organizationId || !activeScope || requestScope !== activeScope) {
      toast.error("Inicie sessão e selecione uma organização.");
      return;
    }

    const generation = lifecycleRef.current;
    const controller = new AbortController();
    streamAbortRef.current = controller;
    setLoading(true);
    const isActive = () => lifecycleRef.current === generation
      && useOttoStore.getState().scope === requestScope;
    let assistantContent = "";

    try {
      const attachmentPaths = filesToUpload.length > 0
        ? await uploadAttachments(filesToUpload)
        : [...messages].reverse().find((message) => message.attachmentPaths?.length)?.attachmentPaths ?? [];
      if (controller.signal.aborted || !isActive()) return;
      addMessage({ role: "user", content: parsed.data.input, attachmentPaths });
      await requestOttoStream({
        token: accessToken,
        body: {
          messages: buildOttoHistory(messages, parsed.data.input),
          organization_id: organizationId,
          ...(attachmentPaths.length > 0 ? { attachment_paths: attachmentPaths } : {}),
        },
        signal: controller.signal,
        handlers: {
          onText: (content) => {
            if (!isActive()) return;
            assistantContent += content;
            updateLastMessage(assistantContent);
          },
          onPreview: (preview) => {
            if (isActive()) setPendingAction(preview, requestScope);
          },
          onResult: (result) => {
            if (isActive()) applyActionResult(result, requestScope);
          },
        },
      });
      if (isActive()) clearAttachments();
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError") && isActive()) {
        console.error("Otto error:", error);
        toast.error(error instanceof Error ? error.message : "Erro ao comunicar com o Otto.");
      }
    } finally {
      if (isActive()) setLoading(false);
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
    }
  }, [activeScope, addMessage, applyActionResult, clearAttachments, messages, organization?.id, pendingAttachments, session?.access_token, setLoading, setPendingAction, updateLastMessage, uploadAttachments]);

  const decideAction = useCallback(async (decision: OttoActionDecision): Promise<void> => {
    if (actionDecisionRef.current !== null) return;
    const state = useOttoStore.getState();
    const action = state.pendingAction;
    const organizationId = organization?.id;
    const accessToken = session?.access_token;
    if (!action || !organizationId || !accessToken || !activeScope || state.scope !== activeScope) return;
    if (decision === "confirm" && Date.parse(action.expiresAt) <= Date.now()) {
      toast.error("Esta confirmação já expirou.");
      return;
    }

    actionDecisionRef.current = decision;
    setActionDecision(decision);
    const requestScope = state.scope;
    const generation = lifecycleRef.current;
    const controller = new AbortController();
    actionAbortRef.current = controller;
    let receivedResult = false;
    const isActive = () => lifecycleRef.current === generation
      && useOttoStore.getState().scope === requestScope;

    try {
      await requestOttoStream({
        token: accessToken,
        body: {
          organization_id: organizationId,
          confirmation_id: action.confirmationId,
          decision,
        },
        signal: controller.signal,
        handlers: {
          onResult: (result) => {
            if (!isActive()) return;
            receivedResult = true;
            applyActionResult(result, requestScope);
          },
        },
      });
      if (!receivedResult && isActive()) toast.error("O Otto não devolveu o resultado da ação.");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError") && isActive()) {
        console.error("Otto action error:", error);
        toast.error(error instanceof Error ? error.message : "Não foi possível concluir a ação.");
      }
    } finally {
      if (actionAbortRef.current === controller) {
        actionAbortRef.current = null;
        actionDecisionRef.current = null;
        setActionDecision(null);
      }
    }
  }, [activeScope, applyActionResult, organization?.id, session?.access_token]);

  const confirmAction = useCallback(() => { void decideAction("confirm"); }, [decideAction]);
  const cancelAction = useCallback(() => { void decideAction("cancel"); }, [decideAction]);
  const cancelStream = useCallback(() => streamAbortRef.current?.abort(), []);
  const hasActiveScope = scope !== null && scope === activeScope;

  return {
    messages,
    isLoading,
    pendingAction: hasActiveScope ? pendingAction : null,
    actionResult: hasActiveScope ? actionResult : null,
    actionDecision,
    sendMessage,
    confirmAction,
    cancelAction,
    clearMessages,
    cancelStream,
  };
}
