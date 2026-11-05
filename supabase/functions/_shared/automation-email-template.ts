import { renderAutomationTemplate } from './automation-template.ts';

/** Used only after the caller has verified the originating automation run. */
export function renderAutomationEmailTemplate(content: string, variables: Readonly<Record<string, unknown>>, html = false): string {
  const normalized = content.replace(/\{\{[^}]*\}\}/g, token => token.replace(/<[^>]*>/g, ''))
    .replace(/\{\{\s*unsubscribe\s*\}\}/gi, '{{unsubscribe}}');
  // The existing email pipeline replaces this reserved token with a signed URL later.
  return renderAutomationTemplate(normalized, { ...variables, unsubscribe: '{{unsubscribe}}' }, html).text;
}
