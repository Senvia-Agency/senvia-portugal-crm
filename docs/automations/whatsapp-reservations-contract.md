# Reservas de envio WhatsApp

`reserve_automation_whatsapp_send` só pode ser chamada pelo serviço. Valida percurso ativo e caixa WhatsApp Evolution ligada da mesma organização, com Inbox nativa. A tabela de reservas tem RLS e nenhuma permissão de navegador.

A chave organização + caixa + percurso + `visitStepKey` identifica uma tentativa lógica. Um bloqueio transacional por organização/caixa torna a atribuição de horários atômica. Reservas contam mesmo quando o passo termina esperando resposta ou quando o provedor falha; não dependem de `automation_run_steps.status`.

Uma visita reserva um horário com intervalo mínimo de seis segundos. Se futuro, o motor guarda o próprio nó e retoma nesse horário; a mesma visita reutiliza a reserva. Ao retomar atrasado, a autorização volta a respeitar seis segundos desde a última autorização liberada. Cada dia civil é calculado em `Europe/Lisbon`, inclusive mudanças de horário; após 200 reservas, a próxima é marcada a partir das 09:00 locais do dia seguinte com capacidade.

Uma reserva já liberada mantém sua identidade para repetição da mesma tentativa. O histórico idempotente de passos e a política de falhas do motor continuam responsáveis por evitar reenvio após um resultado incerto. O ledger é conservador: falhas não devolvem capacidade. Reservas futuras podem reservar capacidade de dias seguintes. Não constitui garantia contra bloqueio pelo WhatsApp.

O motor só solicita reserva quando existe texto ou mídia para enviar. Um passo que apenas espera resposta não consome uma reserva. Erros do banco interrompem o passo antes do provedor. A publicação exige aplicar a migração antes da nova função; nenhuma tabela ou função foi aplicada a um banco externo durante a implementação.

## Confirmação de entrega

Uma reserva pronta passa atomicamente de `reserved`/`retryable` para `processing`, com um token novo. Só esse token pode encerrar a tentativa por `finalize_automation_whatsapp_send`. O motor guarda `sent` e o identificador real do provedor antes de gravar o passo. Se a gravação do passo falhar, uma retomada recupera esse identificador e não chama o provedor outra vez.

Um resultado `processing` ou `uncertain` exige conferência manual e nunca recebe uma nova autorização automática. Isso cobre interrupção do processo, resposta de rede perdida, resposta de sucesso sem identificador e falha ao gravar a confirmação. Uma rejeição HTTP explícita 408, 429 ou 5xx pode ficar `retryable`; a política de repetição continua limitada e o intervalo mínimo é reservado novamente. Não há desbloqueio automático por tempo de uma tentativa incerta.
