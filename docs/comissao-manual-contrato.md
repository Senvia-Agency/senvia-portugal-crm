# Comissão manual: contrato do servidor

Pedido da BDS (20/11/2026). Dono do servidor: Frink. Tela: Bart.
Migração: `supabase/migrations/20261120120000_manual_commission.sql`.

Não há rotas novas. Tudo passa pelo que a tela já usa: o catálogo em
`organizations.servicos_products_config` e a venda em `sales.servicos_details`.
O banco valida, recalcula e guarda o histórico. A tela nunca decide o valor final.

## 1. Catálogo: campos novos no serviço

Cada item de `servicos_products_config` (array JSON) pode ter:

| Campo | Tipo | Padrão | Significado |
|---|---|---|---|
| `manual_commission` | boolean | `false` | O vendedor monta a conta da comissão na venda. As regras normais (splits, faixas, cartões extra) são ignoradas para este serviço. |
| `commission_payout` | `"monthly"` \| `"weekly"` | `"monthly"` | `weekly`: a comissão é paga na sexta que fecha a semana da venda. |
| `manual_commission_template` | array de tokens ou `null` | `null` | Modelo de conta. Se existir, a venda tem de seguir este modelo. O vendedor só preenche as caixas. |

## 2. Tokens da conta

A conta é uma lista de tokens, sempre `número, operador, número, operador, …, número`
(começa e acaba em número, de 1 a 25 números).

| Token | Formato | Onde |
|---|---|---|
| Número | `{"t":"num","v":10.5}` | venda e modelo |
| Operador | `{"t":"op","v":"+"}`, com `v` em `+ - * /` | venda e modelo |
| Caixa a preencher | `{"t":"slot","label":"Valor"}` | só no modelo |

- Na venda, a caixa preenchida vira número com a mesma etiqueta: `{"t":"num","v":120,"label":"Valor"}`.
- Ordem de cálculo normal da matemática: `×` e `÷` antes de `+` e `−`. Não há parênteses.
- Números: até 4 casas decimais, entre −1 000 000 000 e 1 000 000 000.
- Resultado arredondado a 2 casas. É a comissão do vendedor, em €.

Exemplo de modelo `valor × 0,15`:
`[{"t":"slot","label":"Valor"},{"t":"op","v":"*"},{"t":"num","v":0.15}]`

Venda feita com esse modelo:
`[{"t":"num","v":200,"label":"Valor"},{"t":"op","v":"*"},{"t":"num","v":0.15}]` → 30,00 €

## 3. Venda: linha de um serviço manual

Em `sales.servicos_details["<nome do serviço>"]`:

| Campo | Quem escreve | Notas |
|---|---|---|
| `manual_commission_formula` | tela | Lista de tokens só com números e operadores. Pode faltar ou ser `null`: a venda grava com comissão 0 e a conta é lançada depois. |
| `comissao` | **banco** | O banco reescreve com o resultado da conta (0 sem conta). O valor que a tela mandar é ignorado. |

Na venda, o banco também:
- grava em `sale_commission_splits` uma linha do vendedor (`basis = 'fixed'`, `rate = amount = resultado`);
- soma o resultado em `sales.comissao`;
- **parte da BDS (`org_commission`): a linha manual conta 0.** É uma decisão em aberto do Thiago ("a parte da BDS depois vemos"). Não há suposição gravada.

## 4. Erros (venda recusada, nada é gravado)

Todos com `ERRCODE 22023` e `HINT = 'manual_commission'`. A mensagem já vem em português de Portugal para mostrar ao utilizador.

| Caso | Mensagem |
|---|---|
| Conta mal formada (ordem, token desconhecido, lista vazia, mais de 25 números) | `A conta da comissão de "<serviço>" está incompleta ou mal formada.` |
| Número inválido ou fora dos limites | `A conta da comissão de "<serviço>" tem um número inválido.` |
| Divisão por zero | `A conta da comissão de "<serviço>" divide por zero.` |
| Resultado negativo | `A comissão de "<serviço>" não pode ser negativa.` |
| Conta não segue o modelo do serviço | `A conta da comissão de "<serviço>" tem de seguir o modelo do serviço; só os campos a preencher podem mudar.` |
| Serviço semanal junto com serviço mensal na mesma venda | `Um serviço com comissão semanal tem de ficar numa venda à parte.` |

## 5. Pagamento semanal

Quando **todas** as linhas da venda são serviços `weekly`:
- `commission_payment_month_offset = 0`;
- `commission_expected_date` = sexta-feira da semana da venda, com base na data de ativação e, se não houver, na data da venda. Uma venda feita a uma sexta é paga nessa mesma sexta, e uma feita ao sábado na sexta seguinte.
- `commission_month_override` continua a mandar, se alguém o definir.

As vendas sem serviço semanal continuam exatamente como hoje.

## 6. Histórico de quem mudou a conta

Tabela nova `public.sale_manual_commission_changes` (só leitura para a tela):

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `organization_id` | uuid |
| `sale_id` | uuid (apaga junto com a venda) |
| `product_name` | text |
| `old_formula` / `new_formula` | jsonb (ou `null`) |
| `old_amount` / `new_amount` | numeric(12,2) (ou `null`) |
| `changed_by` | uuid (`auth.uid()` de quem gravou; `null` se veio do sistema) |
| `changed_at` | timestamptz |

- Uma linha por serviço manual sempre que a conta muda, incluindo a primeira vez que é preenchida.
- Leitura: membros da organização e super admin, com a mesma regra de 2 passos das outras tabelas. Ninguém escreve, edita ou apaga pela API.
- Para a tela: `supabase.from('sale_manual_commission_changes').select('*').eq('sale_id', id).order('changed_at', { ascending: false })`. O nome de quem mudou vem de `profiles.full_name` por `changed_by`.

## 7. Quem pode editar a conta depois

Não mudou: quem já pode editar a venda pode editar a conta, com os mesmos bloqueios de venda concluída ou entregue. Cada mudança fica no histórico.

## 8. O que fica de fora

- Parte da BDS nas vendas manuais (decisão do Thiago).
- Ecrã de fecho semanal no Financeiro: as comissões semanais aparecem nas listas atuais, pela data prevista.
