export function deliveryStateLabel(state: string): string {
  const labels: Readonly<Record<string, string>> = {
    pending: 'Pendente', queued: 'Em fila', processing: 'A processar',
    submitted: 'Enviada ao WhatsApp', sent: 'Enviada', delivered: 'Entregue',
    read: 'Lida', failed: 'Falhou', uncertain: 'Envio por confirmar',
    cancelled: 'Cancelada', unknown: 'Estado desconhecido',
  };
  return labels[state] ?? 'Estado desconhecido';
}
