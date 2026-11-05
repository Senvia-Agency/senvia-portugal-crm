# Reconstrução das automações do Senvia OS

Data: 2026-11-04. Implementação no checkout local, baseada integralmente em `2026-11-04-desenho-claude.md`. Nenhuma publicação, migração no banco conectado ou mensagem a contactos reais foi executada.

## Entrega funcional

| Área | Implementação |
| --- | --- |
| Gatilhos | CRM, propostas, vendas, pagamentos/documentos, tarefas, agenda, listas, inatividade, fidelização, email, caixas Meta, SLA de atendimento, agendamento, data de registo e webhook autenticado. Filtros de entrada são avaliados antes de inscrever. |
| Lógica | Condições E/OU aninhadas, operadores de texto/número/data/lista, primeiro caminho correspondente com fallback, filtro no fio, esperas com prazo, dias úteis, objetivo de saída, A/B estável, salto limitado, subautomação e terminar outra automação. |
| Ações | Distribuição fixa/rotação/menor carga, campos, listas, tarefas e prioridade, notificações/email interno, criar lead, converter cliente, venda de proposta, expirar proposta com validade factual, agenda, proposta com linhas reais, WhatsApp, modelos oficiais, caixa, Meta CAPI e Feed. |
| Otto | Classificar, resumir, extrair e redigir rascunho. Rascunho fica numa tarefa de revisão; o texto não é exposto como variável para envio automático. |
| Editor | Verificação antes de ativar, prévia de candidatos para agenda, entrada/parâmetros/saída, simulação isolada, prévia por contacto, notas, copiar/colar, duplicar ramo, contadores, atividade com filtros, métricas, versões, comparação e reposição como rascunho. |
| Criação e reutilização | 21 receitas, assistente de três perguntas e convites de utilização única para copiar modelos entre organizações. Recursos e credenciais da origem são removidos e exigem remapeamento. |
| Operação | Fila persistente para inscrições manuais e repetições em massa, orçamento de execução, alertas, pausa por taxa de falhas, resumo diário e recuperação conservadora de execuções interrompidas. |

A inscrição manual está nas fichas de lead, cliente, venda e proposta, e nas seleções múltiplas existentes de leads e clientes. Vendas e propostas conservam a seleção individual que já possuem.

O Feed tem página real em `/automacoes/feed`, navegação desktop/mobile e leitura das últimas 100 publicações. Só membros ativos da organização conseguem ler. Apenas o serviço publica; apagar um fluxo ou percurso preserva o conteúdo do Feed.

## Semântica e proteção de dados

- O registo que inscreveu o percurso permanece como origem, identidade de reentrada e referência do objetivo. Criar ou converter um registo estabelece um alvo explícito para as ações seguintes, sempre validado na mesma organização e relido antes de agir.
- A desativação de automações da lead é respeitada tanto na origem quanto no alvo criado. O percurso conserva o snapshot da versão com que entrou.
- Novos nós de WhatsApp, email e webhook recebem três tentativas, a cada cinco minutos. Fluxos legados e desativação explícita da política não são alterados.
- Respostas HTTP temporárias podem ser repetidas. Entrega sem confirmação, aceite com falha de gravação e outros resultados ambíguos exigem revisão manual; não são tratados como autorização para reenviar.
- Email, proposta, WhatsApp QR e modelos Meta usam reservas duráveis por execução/visita. Reprocessar uma entrega confirmada não chama novamente o fornecedor. O QR reserva também o intervalo de seis segundos e o teto conservador de 200 reservas por dia de Lisboa.
- Respostas persistidas são reconciliadas pelo tick. O horário de ingestão, o início da espera e o consumo do evento impedem que respostas antigas ou callbacks atrasados libertem uma pergunta nova.
- Datas de inatividade, envio e validade são factuais; não foi inventado histórico para registos antigos.
- O navegador só consegue cancelar execuções ativas, sem alterar destinatário, contexto, sujeito ou estado arbitrário. Segredos permanecem no servidor; consultas de organizações mantêm colunas seguras explícitas.

## Adaptações deliberadas

A execução de um único passo é uma **simulação sem efeitos**. A execução integral de teste permanece distinta e explícita.

As ações financeiras sensíveis criam pedidos para revisão humana e conservam os serviços existentes de aprovação, MFA e emissão. A automação não contorna essas proteções para emitir documentos ou suspender serviços.

A partilha de modelos usa convite explícito; não presume uma hierarquia Agency inexistente no checkout. Objetivos encerram percursos; repetições e saltos são explícitos e limitados. A prévia de ativação apresenta candidatos e limites da consulta, sem prometer uma contagem exata depois de filtros, reentrada e alterações concorrentes.

## Verificação

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Regras, helpers, formulários e adaptadores | 320 testes passaram | `.omo/automation-final-combined-tests.txt` |
| Motor real em harness, handler de email e renderização do Feed | 163 testes passaram | `.omo/automation-final-runtime-tests.txt` |
| Análises e rascunhos Otto | 10 testes passaram | `.omo/automation-ai-final-tests.txt` |
| Tipagem dos módulos frontend da automação | 87 arquivos, incluindo testes, zero diagnósticos | `.omo/automation-scoped-types-with-tests.txt` |
| Funções Edge | 10 entrypoints passaram no Deno check | `.omo/automation-final-edge-types.txt` |
| SQL PostgreSQL descartável | 30 migrações aplicadas, 78 cenários passaram | `.omo/evidence/automation-sql-qa/latest.md` |
| Compilação integrada | Vite aprovado | `.omo/automation-final-build.txt` |

A compatibilidade das receitas foi conferida novamente após os ajustes e integra a bateria combinada. O manifesto SQL foi conferido independentemente contra os hashes dos 30 arquivos atuais, sem divergências.

A checagem global de tipos contém problemas preexistentes fora desta entrega e a última tentativa global excedeu o tempo. A verificação focal acima não equivale a declarar o projeto inteiro livre de erros de TypeScript.

No navegador interno do painel lateral foram exercitados componentes reais: assistente, receitas, condições/grupos, router, validação, esperas, objetivo, prévia de mensagem, comparação de versões, filtro no fio, atividade, confirmação de candidatos e Feed. O harness usa dados fictícios e bloqueia operações externas; isso não equivale a validar sessão autenticada e gravação no CRM online.

As revisões independentes estão em `.omo/evidence/automation-engine-code-review.md`, `.omo/evidence/automation-rebuild-code-review.md` e `.omo/evidence/automation-sql-security-code-review.md`. Não restaram bloqueadores de alta prioridade; permanecem observações de manutenção e limites operacionais documentados nos contratos específicos.

## Publicação

A implementação e as migrações continuam locais. Ainda não foram exercitados no ambiente conectado: cron, Vault, pg_net, MFA real, canais dos fornecedores e interface autenticada com persistência real.

Quando a publicação for autorizada, seguir `AGENTS.md`: frontend por push para `main` e build Git da Vercel; nunca publicar artefatos locais de produção. Conferir o SHA completo e executar `npm run verify:production -- <sha>` depois da publicação. Preservar as alterações paralelas do checkout.
