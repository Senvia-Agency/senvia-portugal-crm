# Integração da reconstrução na main

Data: 2026-11-05. Base de integração: `e624e186308fb6a7a2a0802c022a60610348736a`.

## Compatibilidade preservada

- As 30 migrações novas receberam versões únicas geradas pelo Supabase CLI, posteriores à base da main. O conteúdo SQL mantém exatamente os hashes da bateria original; nenhum SQL de migração já existente foi alterado.
- O Feed geral permanece em `/feed`; as publicações das automações ficam em `/automacoes/feed`.
- O dispatcher nativo `notify_automation_trigger` mantém o corpo existente. A alteração acrescenta a proteção de leads desativadas e o tipo de sujeito de propostas; não remove a chamada ao motor que processa os workflows configurados.
- As tabelas e funções dos workflows configurados permanecem. Reservas de ocorrência por `enrollment_key` só restringem inscrições que fornecem uma chave explícita. O ledger de etapas configuradas e a prova de ativação permanecem independentes.

## Verificação SQL de integração

Banco descartável: PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten, compiled by emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.74 (1092ec30a3fb1d46b1782ff1b4db5094d3d06ae5), 32-bit.

Foram aplicadas primeiro as três migrações da main relativas a agendamento, reservas de etapas e provas de ativação de workflows configurados. Depois foram aplicadas as 30 migrações da reconstrução, sem mudar o SQL. Passaram 81 cenários: os 78 da reconstrução e três de integração. Estes confirmam a rejeição da ativação direta, o consumo único da prova de ativação com incremento/arquivo de versão, e a reserva idempotente de etapa com snapshot fixo do percurso.

O fixture reduzido não equivale a uma reprodução integral do ambiente conectado. MFA é simulado no fixture de integração; cron, Vault, pg_net real e fornecedores não foram executados.

Reprodução local: `node .omo/evidence/automation-sql-qa/run.mjs`. Evidência: `.omo/evidence/automation-sql-qa/results.json` e `.omo/release-migration-qa/main-compatible.log`.

## Estado de publicação

Esta integração prepara o envio de código para `main` e o build Git da Vercel. O push de código não aplica por si só as migrações nem publica as funções Edge. A ativação completa das capacidades novas depende de publicar o backend correspondente e conferir o ambiente conectado. Não foram realizadas alterações na base de produção por esta etapa de integração.

## Migrações da entrega

| Versão original local | Versão de publicação | SHA256 preservado |
| --- | --- | --- |
| 20261104120000_automation_run_flow_snapshot.sql | 20261105102336_automation_run_flow_snapshot.sql | 58b645e483efabba2a8d727f2b504a7a8ecedc9d9c6bb8febbc6d99f7d1cc334 |
| 20261104121000_automation_versions_metrics.sql | 20261105102338_automation_versions_metrics.sql | c29ab3e587b089c0ca01ddddd81fdf5fe0ee0560b1437d8fd28479328f4afc01 |
| 20261104122000_automation_branch_metrics.sql | 20261105102340_automation_branch_metrics.sql | 74f09b398112f40921c9c158ecce6c3bbeb72b7ff6386cb0781c7f808a11d249 |
| 20261104130000_automation_assign_subject.sql | 20261105102341_automation_assign_subject.sql | ad1cd08534f92a2060f8ca8b4376482438a29bc9f4fdb54f2d019cb9acd48075 |
| 20261104132000_automation_schedule.sql | 20261105102343_automation_schedule.sql | a691892526bb43b36c478ca55e456e4809a5e3fd3f44412efbf023ea9666dd73 |
| 20261104140000_automation_convert_lead.sql | 20261105102345_automation_convert_lead.sql | fd748a211299a9e26a72a04e19be79e553e9103d238d9cfbd4ffaf5db6a85471 |
| 20261104142000_automation_crm_events.sql | 20261105102347_automation_crm_events.sql | 6c141041f1c8ef12353d1522687eee9f39ab984a21f616738b58f9414655e0a4 |
| 20261104144000_automation_time_events.sql | 20261105102349_automation_time_events.sql | fd873185632457bfb53e768a0e2f4aa5a5dea7628c8ea4ff992f03cb19e5e817 |
| 20261104150000_automation_hook_secrets.sql | 20261105102351_automation_hook_secrets.sql | 7db8c6650920c38cc9e6567262187cd07e2d73a244cf5adb068b8a0f13455719 |
| 20261104152000_automation_email_events.sql | 20261105102353_automation_email_events.sql | fb1bb64eea19f976ffed6b532c40fd8571a31895756ae9c2ab573127cbe3aa7a |
| 20261104160000_automation_email_correlation.sql | 20261105102355_automation_email_correlation.sql | fb79657a5779518cc276e9acb1fd5305ec7adb538ad41dce7838513bd887311a |
| 20261104170000_automation_failure_operations.sql | 20261105102358_automation_failure_operations.sql | 2c0e1cd6a5f2494b89bec0fbc162486eeffc637b24674522569be3078f145b42 |
| 20261104180000_automation_lifecycle_events.sql | 20261105102400_automation_lifecycle_events.sql | 080d8583edc60eb00e947ee64029616af6596f5f6cce8dc0997f1964643859c3 |
| 20261104181000_automation_financial_requests.sql | 20261105102402_automation_financial_requests.sql | 9670aa91bdda4ea7cc6c81388951a436b970c71ed1477fb564eb82c005c4aa69 |
| 20261104182000_automation_financial_events.sql | 20261105102404_automation_financial_events.sql | bb5d6ccb81ad833efdc22bdcb919175440bc125dcbb028b4b47d2124ba154eb5 |
| 20261104183000_automation_meta_expense_events.sql | 20261105102406_automation_meta_expense_events.sql | 3746c33bb9440890a32c6988567c04f8887da9e3e37382c659bb38a1357e2d92 |
| 20261104200000_automation_record_actions.sql | 20261105102409_automation_record_actions.sql | 78761448069ed391d6f5626c93d9bb04d58e1898d7a2ace518a984495b4ec10c |
| 20261104210000_automation_reply_drafts.sql | 20261105102410_automation_reply_drafts.sql | 8ce2f2e2387d7a5d41e449e5f11298fecc50eb50d26d1ca594c6e2a58b48469f |
| 20261104211000_automation_template_invites.sql | 20261105102412_automation_template_invites.sql | 8166d292b153894fd5e2fd75974a151f49c03eae9d04979b4b8cc82f24ad6140 |
| 20261104220000_automation_inbox_events.sql | 20261105102414_automation_inbox_events.sql | 039beb61172905ab221f98d735a91bc01c5cc293a5ff03ca5d845c933504c977 |
| 20261104221000_automation_proposal_actions.sql | 20261105102416_automation_proposal_actions.sql | a432143bee8c45aab16ebf4d3311a335362934985954f24622c2305157901975 |
| 20261104222000_automation_reply_facts.sql | 20261105102418_automation_reply_facts.sql | f7e4c1f5ed8cc9eb7eb1800d540373440f5bd48eedcff818f1dbd383929da469 |
| 20261104223000_automation_list_events.sql | 20261105102420_automation_list_events.sql | 251dd9a4dab1a8266f84a7d78b5aa7fd253560136c2b7202f8e47e36acfcefc7 |
| 20261104224000_task_priority.sql | 20261105102422_task_priority.sql | a9344cbd6ecf87d8f62c96bed92cc7e402c11a15cda7c1206f617be4c026c6c6 |
| 20261104230000_automation_email_delivery_claims.sql | 20261105102424_automation_email_delivery_claims.sql | 769cc9f5ecc9ee6aafb428b8c984c78ae6b1e97b536e449a84e46557d8c35a43 |
| 20261104231000_browser_run_cancellation_guard.sql | 20261105102425_browser_run_cancellation_guard.sql | ed214418c579741482233e24b3506e20f410fabef61236b29cace3740fabe802 |
| 20261104232000_automation_durable_replies.sql | 20261105102427_automation_durable_replies.sql | b8988f21c19317188d55e0e2ca31e9d5f33f3c01120c34b505f62062bd33e547 |
| 20261104233000_automation_whatsapp_send_reservations.sql | 20261105102429_automation_whatsapp_send_reservations.sql | 6da8ff03b24df00e5ea53751beecdfdb49fe746c46d9259de557ae5995fbad3d |
| 20261104234000_automation_meta_delivery_claims.sql | 20261105102431_automation_meta_delivery_claims.sql | 3563833493bce0dd7d1e012a9458cab0b7cb418f4a3c515c5d1f7889a43f432b |
| 20261104235000_organization_automation_feed.sql | 20261105102433_organization_automation_feed.sql | 056010dafe6085290c7538d3ce647fabce00bb242d22bf94badc97c6bde8132f |
