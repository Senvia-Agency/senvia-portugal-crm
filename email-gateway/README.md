# Senvia Email Gateway

Serviço Node sempre-ligado que dá às **caixas de email** do CRM uma experiência de
cliente de email completo (Entrada / Enviados / Rascunhos / Spam / Lixo / pastas),
falando **IMAP/SMTP diretamente** — sem passar pelo Chatwoot.

As caixas de **mensagens** (WhatsApp / Instagram / Messenger) continuam no Chatwoot.

## Stack (tudo MIT, sem licenças)

- [ImapFlow](https://imapflow.com) — IMAP (sync de pastas, flags, IDLE/tempo real)
- [Nodemailer](https://nodemailer.com) — envio SMTP
- [mailparser](https://nodemailer.com/extras/mailparser/) — parsing de MIME
- [@supabase/supabase-js](https://supabase.com) — escreve o email sincronizado no Postgres
- [Fastify](https://fastify.dev) — API de ações (enviar, mover, apagar, marcar…)

## Arquitetura

```
Frontend (React) ──read/realtime──> Supabase (Postgres + RLS)
       │                                  ▲
       └──action──> Edge Function ──HTTP──┤ (este gateway)
                                          │
                          ImapFlow/Nodemailer
                                          │
                                IMAP/SMTP (Zoho/Gmail/Outlook)
```

O gateway escreve o email em Postgres (service role); o frontend lê via Supabase
com RLS e recebe atualizações em tempo real. As ações do frontend chegam aqui via
uma Edge Function que assina os pedidos com `GATEWAY_SHARED_SECRET`.

## Desenvolvimento

```bash
cd email-gateway
npm install
cp .env.example .env     # preencher TEST_IMAP_PASSWORD (app-password Zoho)
npm run test:connect     # prova de conectividade (lista pastas + últimas mensagens)
```

## Servidor vivo

`src/server.js` mantém uma ligação IMAP por caixa em **IDLE** — emails novos são
sincronizados para o Postgres no instante em que chegam (o frontend atualiza via
Supabase Realtime). API HTTP (autenticada com `GATEWAY_SHARED_SECRET`):

- `GET  /health` — estado das caixas (sem auth)
- `POST /caixas/:id/sync` — força resync completo
- `POST /messages/:id/body` — fetch do corpo on-demand

```bash
npm start   # precisa de DATABASE_URL + GATEWAY_SHARED_SECRET no .env
```

## Deploy (servidor do Chatwoot, em Docker)

Corre como **container separado**, ao lado do Chatwoot — **não toca no Chatwoot**.

```bash
# no servidor, dentro de email-gateway/
docker build -t senvia-email-gateway .
docker run -d --name senvia-email-gateway --restart unless-stopped \
  -e DATABASE_URL="postgresql://...pooler.supabase.com:5432/postgres" \
  -e GATEWAY_SHARED_SECRET="<segredo-forte>" \
  -e PORT=8730 \
  -p 8730:8730 \
  senvia-email-gateway
```

Para o frontend/Edge Functions chegarem ao gateway, expor `:8730` num subdomínio
HTTPS (ex.: `email-gw.senvia.pt`) via o nginx que já serve o Chatwoot. Custo
extra de infra: 0 €.

## Ligações, envio e assinaturas (2026-11-04)

- **Limite por servidor** (`host-slots.js`): no máximo 2 caixas do mesmo servidor
  fazem login + sincronização inicial ao mesmo tempo, e no máximo 2 envios SMTP
  por servidor. O alojamento partilhado (cPanel) recusa ligações a mais.
- **Nova tentativa**: o SMTP tenta mais uma vez só quando falha a ligar (antes de
  o servidor aceitar a mensagem, para nunca enviar duas vezes). O IMAP volta a
  ligar 5 s depois. As Edge Functions de email tentam ligar mais uma vez
  (`_shared/imap-retry.ts`) e o browser envia no máximo 2 pedidos destes de cada vez.
- **Envio sem IMAP**: enviar já não exige a ligação IMAP ativa. A cópia em
  Enviados fica para a sincronização seguinte.
- **Erros de envio claros** (`smtp-errors.js`): o motivo em pt-PT, com a resposta
  do servidor.
- **Imagens da assinatura embutidas** (`inline-images.js`): as imagens do bucket
  `email-signatures` vão dentro do email (`cid:`) em vez de link. Só o storage da
  Senvia é descarregado (`INLINE_IMAGE_HOST` muda o host, se for preciso).

Precisa de reconstruir e relançar o contentor (ver abaixo).

## Depois de 2026-08-13: as passwords mudaram de sítio

`imap_password` e `smtp_password` deixaram de estar em `messaging_channels.metadata`
e passaram para `messaging_channel_secrets` — o metadata era lido pelo CRM no
browser, por isso a password da caixa de correio chegava a qualquer membro da
organização.

O `caixas.js` já lê do sítio novo, com recurso ao antigo enquanto houver caixas
por migrar. **É preciso reconstruir e relançar o contentor** para apanhar a
alteração:

```bash
cd email-gateway
docker build -t senvia-email-gateway .
docker rm -f senvia-email-gateway
# (voltar a correr com as mesmas variáveis de ambiente de sempre)
```

Enquanto não relançares, o gateway antigo continua a funcionar: a password já
não está no metadata, mas ele lê a tabela toda e o `COALESCE` do código novo é
que faz a ponte — ou seja, o contentor **antigo** deixa de encontrar a password.
Relança assim que puderes.
