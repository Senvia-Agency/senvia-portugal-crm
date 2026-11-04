import { useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

export interface TemplateVariable {
  token: string;
  label: string;
}

// Canonical variables available in first-contact (welcome) message templates.
// Keep in sync with renderTemplate() in supabase/functions/submit-lead/index.ts.
export const WELCOME_VARIABLES: TemplateVariable[] = [
  { token: '{{primeiro_nome}}', label: 'Primeiro nome' },
  { token: '{{nome}}', label: 'Nome completo' },
  { token: '{{email}}', label: 'Email' },
  { token: '{{telefone}}', label: 'Telefone' },
  { token: '{{empresa}}', label: 'Empresa' },
  { token: '{{nif}}', label: 'NIF' },
  { token: '{{fonte}}', label: 'Fonte' },
  { token: '{{responsavel}}', label: 'Responsável' },
  { token: '{{minha_empresa}}', label: 'A minha empresa' },
];

interface MessageTemplateFieldProps {
  id?: string;
  label?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  variables?: TemplateVariable[];
}

// Textarea for message templates with a row of clickable variable chips that
// insert the token at the current caret position (not just appended).
export function MessageTemplateField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 8,
  className,
  variables = WELCOME_VARIABLES,
}: MessageTemplateFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { t } = useLanguage();

  const insert = (token: string) => {
    const el = ref.current;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Restore caret right after the inserted token (post-render).
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-1.5">
      {label && <Label htmlFor={id}>{label}</Label>}
      {variables.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {variables.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => insert(v.token)}
              title={t('Inserir {{token}}', { token: v.token })}
              className="text-[11px] rounded-full border bg-muted/50 px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {t(v.label)}
            </button>
          ))}
        </div>
      )}
      <Textarea
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
    </div>
  );
}
