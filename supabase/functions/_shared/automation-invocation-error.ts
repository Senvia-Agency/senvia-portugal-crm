/** Preserve HTTP failure classification without reading a provider response body. */
export function formatAutomationInvocationError(error: unknown, label: string): string {
  const message = typeof error === 'object' && error !== null && 'message' in error &&
      typeof error.message === 'string' ? error.message.trim().slice(0, 500) : '';
  const context = typeof error === 'object' && error !== null && 'context' in error
    ? error.context : undefined;
  const status = typeof context === 'object' && context !== null && 'status' in context &&
      typeof context.status === 'number' && Number.isInteger(context.status) &&
      context.status >= 400 && context.status <= 599 ? context.status : undefined;
  const prefix = status === undefined ? label : `${label} HTTP ${status}`;
  return message ? `${prefix}: ${message}` : prefix;
}
