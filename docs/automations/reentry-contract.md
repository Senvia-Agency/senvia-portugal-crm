# Intervalo mínimo de reentrada

A definição `trigger_config.reentry_cooldown_days` aceita um número inteiro de 0 a 3660. O editor mostra este campo quando a política é `after_completion` e impede guardar um valor inválido. O motor valida novamente antes de inscrever.

O intervalo é contado a partir de `automation_runs.completed_at`, usando o último percurso terminado (concluído, falhado ou cancelado) da mesma organização, automação, tipo e identificador do sujeito. Percursos com `context.__test = true` não contam. Na fronteira exata de N períodos de 24 horas, a nova entrada já é permitida.

Valor ausente ou 0 permite entrar assim que o percurso anterior terminar. A política `once` conserva a restrição de uma entrada. O índice de percursos ativos continua a impedir inscrições simultâneas para o mesmo sujeito e fluxo.

Quando o intervalo ainda não terminou, a resposta de inscrição inclui o motivo e `next_entry_at`; não é criado percurso. A reentrada depende de um novo evento ou execução agendada após esse instante, sem inscrever retroativamente por causa da configuração.

Não exige migração. Helpers: `readReentryCooldownDays` e `reentryCooldownDecision` em `supabase/functions/_shared/automation-reentry.ts`.

Nos gatilhos «Mensagem recebida» e «Palavra-chave WhatsApp», a política usa a chave normalizada do telefone, na mesma organização e automação. Mudar de conversa ou caixa não contorna o intervalo. O bloqueio de percurso ativo continua a proteger a conversa em curso e a extensão de um buffer existente não constitui nova inscrição.

Repetir explicitamente uma execução como administrador é recuperação e não espera pelo cooldown. Testes também permanecem fora desta política. A decisão de banco partilhada está em `supabase/functions/automation-engine/reentry-policy.ts`.

Contactos sem ficha usam uma identidade lógica UUIDv8 obtida de SHA-256 sobre
organização + telefone normalizado (prioritário) ou email em minúsculas sem
espaços nas extremidades. Eventos distintos do mesmo contacto deixam de gerar
sujeitos distintos. Sem telefone/email, conserva-se um identificador UUID válido.
Lead, cliente, venda e proposta conservam os seus identificadores físicos.

O identificador original do evento fica em `context.id` e
`context.__origin_subject_id`; conversas continuam em `context.conversa_id`.
Consultas de inscrição anterior, percurso ativo e intervalo usam organização,
fluxo e tipo de sujeito. Contactos antigos são reconhecidos pelo telefone ou
email, mesmo que o sujeito antigo tenha sido um evento/conversa. Testes ficam
excluídos dessas verificações. Nenhuma migração destrutiva é necessária.
