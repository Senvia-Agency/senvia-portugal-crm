import type { RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useFlowVariables } from '@/components/automations/FlowIoContext';

/**
 * Contact variables the engine resolves when rendering message templates
 * ({{nome}} → run context). Shown under every message-editing field.
 */
// Estes nomes são os mesmos da configuração de IA antiga, de propósito: uma
// mensagem copiada de lá funciona aqui tal e qual. Antes faltava
// {{primeiro_nome}}, que é o mais usado de todos — ficava por substituir e o
// contacto recebia "Olá, {{primeiro_nome}}!".
export const VARIABLES = [
  { token: '{{primeiro_nome}}', label: 'Primeiro nome' },
  { token: '{{nome}}', label: 'Nome completo' },
  { token: '{{email}}', label: 'Email' },
  { token: '{{telefone}}', label: 'Telefone' },
  { token: '{{empresa}}', label: 'Empresa' },
  { token: '{{nif}}', label: 'NIF' },
  { token: '{{fonte}}', label: 'Fonte' },
  { token: '{{ultima_resposta}}', label: 'Última resposta' },
];

interface VariableChipsProps {
  /** The input/textarea the chips insert into — needed for the caret position. */
  targetRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** Current value of that field (the config is the source of truth). */
  value: string;
  onChange: (next: string) => void;
  className?: string;
}

/**
 * Clickable variable badges that insert the token at the CURSOR position of
 * the associated field (replacing any selection), not just at the end.
 */
export function VariableChips({ targetRef, value, onChange, className }: VariableChipsProps) {
  // Inside a step's details view the flow says which variables exist (the
  // trigger's record, the last reply…); elsewhere, the contact basics.
  const flowFields = useFlowVariables();
  const variables = flowFields
    ? flowFields.map((field) => ({ token: `{{${field.key}}}`, label: field.label }))
    : VARIABLES;
  const insert = (token: string) => {
    const el = targetRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));

    // Put the caret right after the inserted token once React re-renders.
    requestAnimationFrame(() => {
      const target = targetRef.current;
      if (!target) return;
      target.focus();
      const caret = start + token.length;
      try {
        target.setSelectionRange(caret, caret);
      } catch {
        // Some input types don't support selection ranges — appending still worked.
      }
    });
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-[11px] text-muted-foreground">Inserir variável:</span>
      {variables.map((variable) => (
        <button
          key={variable.token}
          type="button"
          onClick={() => insert(variable.token)}
          title={variable.token}
          className={cn(
            'rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium',
            'text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary',
          )}
        >
          {variable.label}
        </button>
      ))}
    </div>
  );
}
