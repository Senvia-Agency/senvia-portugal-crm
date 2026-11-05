# Entrada e saída de listas

A migração `20261105102420_automation_list_events.sql` observa inserções e remoções reais de `marketing_list_members`.

- `list_joined`: uma nova associação foi criada. Uma associação já existente mantida por `ON CONFLICT` não dispara novamente.
- `list_left`: uma associação foi removida. Remover uma lista/contacto inteiro por cascata não inventa um destinatário já eliminado.
- `trigger_config.list_id`: opcional; quando definido, apenas esta lista pode inscrever o contacto. O filtro é aplicado no dispatcher e novamente no motor, inclusive em inscrições internas/manuais.

A organização vem da lista e tem de coincidir com a do contacto de marketing. Um guarda impede novas associações ou atualizações entre organizações sem alterar privilégios de leitura.

Um cliente com email único na organização é preferido. Se não houver clientes com o email, uma lead única é usada, respeitando `automation_enabled`. Um email ambíguo mantém o sujeito `contact` com o identificador real do contacto de marketing, sem escolher uma lead arbitrária.

Contexto: `list_id`, `list_name`, `list_event`, `marketing_contact_id`, `list_membership_id`, nome/email/telefone do sujeito. A ocorrência é `<membership-id>:<event>`, protegida pelo índice de inscrição existente. Reentrada continua a respeitar a política do fluxo.

Sair de uma lista não é, por si só, pedido de cancelamento de todas as mensagens. A supressão por cancelamento de subscrição continua no evento específico `email_unsubscribed`.
