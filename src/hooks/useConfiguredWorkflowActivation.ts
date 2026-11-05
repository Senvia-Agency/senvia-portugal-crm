import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  activateConfiguredWorkflow,
  configuredWorkflowActivationEndpoint,
  prepareConfiguredWorkflowActivation,
  type ConfiguredWorkflowActivationPreview,
  type ConfiguredWorkflowActivationProof,
} from '@/lib/configured-workflow-activation-client';

export type ConfiguredWorkflowActivationState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'preparing' }>
  | Readonly<{ status: 'awaiting_confirmation'; preview: ConfiguredWorkflowActivationPreview; expiresAt: string }>
  | Readonly<{ status: 'activating'; preview: ConfiguredWorkflowActivationPreview }>
  | Readonly<{ status: 'activated' }>
  | Readonly<{ status: 'failed'; message: string }>
  | Readonly<{ status: 'unknown'; message: string }>;

type ProofWithPreview = ConfiguredWorkflowActivationProof & Readonly<{
  preview: ConfiguredWorkflowActivationPreview;
}>;

export function useConfiguredWorkflowActivation(flow: Readonly<{ id: string; version: number; updated_at: string }>) {
  const { session, organization } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConfiguredWorkflowActivationState>({ status: 'idle' });
  const proofRef = useRef<ProofWithPreview | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const lifecycleRef = useRef(0);
  const accessToken = session?.access_token ?? null;
  const scope = session?.user.id && organization?.id
    ? `${session.user.id}:${organization.id}:${flow.id}:${flow.version}:${flow.updated_at}`
    : null;

  useEffect(() => {
    lifecycleRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    proofRef.current = null;
    setState({ status: 'idle' });
    return () => {
      lifecycleRef.current += 1;
      requestRef.current?.abort();
    };
  }, [scope]);

  const prepare = useCallback(async (): Promise<void> => {
    if (requestRef.current || !scope || !accessToken) return;
    const endpoint = configuredWorkflowActivationEndpoint(import.meta.env.VITE_SUPABASE_URL);
    if (!endpoint) {
      setState({ status: 'failed', message: 'O serviço de ativação não está configurado.' });
      return;
    }
    const generation = lifecycleRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    proofRef.current = null;
    setState({ status: 'preparing' });
    const result = await prepareConfiguredWorkflowActivation({
      endpoint,
      flowId: flow.id,
      version: flow.version,
      updatedAt: flow.updated_at,
      accessToken,
      signal: controller.signal,
    });
    if (lifecycleRef.current !== generation || controller.signal.aborted) return;
    requestRef.current = null;
    if (!result.ok) {
      setState({ status: 'failed', message: result.message });
      return;
    }
    proofRef.current = { ...result.proof, preview: result.preview };
    setState({ status: 'awaiting_confirmation', preview: result.preview, expiresAt: result.proof.expiresAt });
  }, [accessToken, flow.id, flow.updated_at, flow.version, scope]);

  const cancel = useCallback((): void => {
    if (requestRef.current) return;
    proofRef.current = null;
    setState({ status: 'idle' });
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (requestRef.current || state.status !== 'awaiting_confirmation' || !accessToken || !scope) return;
    const endpoint = configuredWorkflowActivationEndpoint(import.meta.env.VITE_SUPABASE_URL);
    const proof = proofRef.current;
    if (!endpoint || !proof || Date.parse(proof.expiresAt) <= Date.now()) {
      proofRef.current = null;
      setState({ status: 'failed', message: 'A prévia expirou. Prepare uma nova revisão.' });
      return;
    }
    const generation = lifecycleRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    proofRef.current = null;
    setState({ status: 'activating', preview: proof.preview });
    const result = await activateConfiguredWorkflow({
      endpoint,
      accessToken,
      signal: controller.signal,
      flowId: flow.id,
      previewId: proof.previewId,
      snapshotDigest: proof.snapshotDigest,
      expiresAt: proof.expiresAt,
    });
    if (lifecycleRef.current !== generation || controller.signal.aborted) return;
    requestRef.current = null;
    if (!result.ok) {
      setState(result.kind === 'unknown'
        ? { status: 'unknown', message: result.message }
        : { status: 'failed', message: result.message });
      return;
    }
    setState({ status: 'activated' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['automation-flow', flow.id] }),
      queryClient.invalidateQueries({ queryKey: ['automation-flows'] }),
    ]);
  }, [accessToken, flow.id, queryClient, scope, state.status]);

  return { state, prepare, confirm, cancel } as const;
}
