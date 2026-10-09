// meta-webhook — recebe mensagens de Instagram e Messenger direto da Meta.
//
// Sem Chatwoot: a Meta entrega aqui, guardamos em meta_conversations /
// meta_messages, e o CRM lê de lá. O Chatwoot fica só com o email.
//
// Duas entradas, como a Meta exige:
//   GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//        -> devolve o challenge, é assim que ela valida o endereço
//   POST -> os eventos
//
// Sobre a assinatura: a Meta assina cada POST em X-Hub-Signature-256 com o App
// Secret. É verificada — sem isso, qualquer pessoa que descubra este endereço
// podia injetar mensagens falsas nas conversas dos clientes.

import { scheduleInboxTaskSuggestions } from '../_shared/inbox-task-dispatch.ts';
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

const log = (s: string, d?: unknown) =>
  console.log(`[META-WEBHOOK] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);
const logError = (s: string, d?: unknown) =>
  console.error(`[META-WEBHOOK] ERROR ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

/** A janela de resposta da Meta: 24h desde a última mensagem DA PESSOA. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * O nome de quem escreveu, pela API de CONVERSAS.
 *
 * Existe porque a API de perfil (`GET /{psid}`) não serve toda a gente: com a
 * app em Acesso Padrão, a Meta só devolve o perfil de quem tem cargo nela e
 * responde `(#100) subcode 33` a todos os outros. Ou seja, os contactos de
 * teste apareciam com nome e os clientes reais como um número de 17 dígitos.
 *
 * A API de conversas é outra porta e devolve o nome verdadeiro — confirmado
 * contra a produção: o mesmo identificador que a de perfil recusou veio aqui
 * como "Phillips Steven".
 *
 * Duas notas do que se aprendeu a testar isto:
 *  - No Messenger, `participants` devolve o marcador "Usuário do Facebook"; é
 *    `messages{from}` que traz o nome a sério. No Instagram servem os dois.
 *  - `messages` vem da mais recente para trás e a mais recente pode ser NOSSA,
 *    por isso procura-se a primeira cujo autor é mesmo a pessoa.
 *
 * A fotografia não tem equivalente: para quem a app não alcança, a Meta serve
 * a silhueta genérica. Isso só a App Review resolve.
 */
async function nomePelaConversa(
  pageId: string,
  senderId: string,
  ehInstagram: boolean,
  token: string,
): Promise<string | null> {
  const url = new URL(`https://graph.facebook.com/v21.0/${pageId}/conversations`);
  if (ehInstagram) url.searchParams.set("platform", "instagram");
  url.searchParams.set("user_id", senderId);
  url.searchParams.set("fields", "participants,messages.limit(10){from}");
  url.searchParams.set("access_token", token);

  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body?.error) {
    log("conversa sem nome disponível", { senderId, erro: body?.error?.message });
    return null;
  }

  const conversa = body?.data?.[0];
  if (!conversa) return null;

  interface Autor { id?: string; name?: string; username?: string }

  const daPessoa = (a: Autor | undefined) => a?.id === senderId;
  const doAutor = (a: Autor | undefined) =>
    a?.username ? `@${a.username}` : (a?.name ?? null);

  const msg = (conversa.messages?.data ?? [] as Array<{ from?: Autor }>)
    .find((m: { from?: Autor }) => daPessoa(m.from));
  const pelaMensagem = doAutor(msg?.from);
  if (pelaMensagem) return pelaMensagem;

  const participante = (conversa.participants?.data ?? [] as Autor[]).find(daPessoa);
  return doAutor(participante);
}

async function signatureValid(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  const received = header.slice(7);
  // Comparação de tempo constante: uma comparação normal desiste no primeiro
  // byte diferente e deixa adivinhar a assinatura pelo tempo de resposta.
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

/**
 * Mensagens, contactos e estados do WhatsApp Cloud API.
 *
 * Três diferenças que mudam o código, e não só o formato:
 *
 *  1. O NOME VEM NA MENSAGEM. `contacts[].profile.name` está logo aqui — não é
 *     preciso o pedido extra de perfil que o Instagram e o Messenger obrigam, e
 *     não há o problema de a Meta recusar o perfil de quem não tem cargo na app.
 *  2. HÁ ESTADOS DE ENTREGA. `statuses[]` diz se a mensagem foi entregue, lida
 *     ou falhou. Não são mensagens novas — anotam-se na que já lá está.
 *  3. AS REAÇÕES SÃO EMOJI A SÉRIO, ao contrário do Instagram (que só aceita a
 *     palavra "love").
 */
async function processarWhatsApp(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: any,
): Promise<{ resultado: string; phoneNumberId: string | null; orgId: string | null }> {
  let resultado = "sem_eventos";
  let phoneNumberId: string | null = null;
  let orgId: string | null = null;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change?.value;
      if (!value) continue;

      // ── Estado de um modelo de mensagem ──────────────────────────────────
      //
      // TEM DE VIR ANTES do `phone_number_id`. Este evento é da CONTA, não de
      // um número: não traz `metadata.phone_number_id` nenhum, e mais abaixo
      // seria descartado pelo `continue` sem nunca chegar a lado nenhum. A
      // conta vem no `entry.id`.
      //
      // Sem isto, a nossa cópia dos modelos envelhecia em silêncio e o
      // compositor oferecia modelos que a Meta já tinha recusado ou pausado.
      if (change.field === "message_template_status_update") {
        const wabaId = String(entry.id ?? "");
        const metaId = String(value?.message_template_id ?? "");
        if (wabaId && metaId) {
          const { data: canal } = await supabase
            .from("messaging_channels")
            .select("id, organization_id")
            .eq("metadata->>waba_id", wabaId)
            .eq("provider", "meta")
            .is("archived_at", null)
            .limit(1)
            .maybeSingle();
          if (canal) {
            orgId = canal.organization_id;
            await supabase.from("whatsapp_templates").update({
              status: String(value?.event ?? "UNKNOWN"),
              rejected_reason: value?.reason ?? null,
              status_updated_at: new Date().toISOString(),
            }).eq("channel_id", canal.id).eq("meta_id", metaId)
              .then(() => {}, (e: unknown) => logError("estado do modelo não gravado", { e }));
            log("estado de modelo atualizado", { metaId, evento: value?.event });
          }
        }
        resultado = "modelo";
        continue;
      }

      const numeroId = String(value?.metadata?.phone_number_id ?? "");
      if (!numeroId) continue;
      phoneNumberId = numeroId;

      const { data: channel, error: canalErr } = await supabase
        .from("messaging_channels")
        .select("id, organization_id, channel_type, assigned_user_ids, label, phone_number, metadata")
        .eq("metadata->>phone_number_id", numeroId)
        .eq("provider", "meta")
        // Uma caixa arquivada já não recebe. Sem este filtro, ter arquivado uma
        // e voltado a ligar o mesmo número deixava duas linhas a competir, e o
        // `.limit(1)` escolhia ao acaso qual delas ficava com as mensagens.
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (canalErr) logError("procura de canal WhatsApp falhou", { error: canalErr.message });

      if (!channel) {
        log("WhatsApp de um número que não temos ligado", { numeroId });
        resultado = "sem_canal";
        continue;
      }
      orgId = channel.organization_id;

      // ── Coexistence ───────────────────────────────────────────────────────
      //
      // O cliente mantém o número na app do WhatsApp Business e o CRM espelha.
      // São estes três campos que fazem o espelho funcionar — sem eles a
      // Coexistence liga-se e não serve de nada:
      //
      //   history            → as conversas antigas (até 180 dias)
      //   smb_message_echoes → o que o DONO escreve pelo telemóvel
      //   smb_app_state_sync → os contactos
      //
      // O do meio é o que mais importa: sem ele o CRM via só o que entra, e a
      // conversa ficava com metade do diálogo — as respostas dadas no telemóvel
      // não apareciam em lado nenhum.
      if (change.field === "history" || change.field === "smb_message_echoes") {
        // QUEM SOMOS NÓS, nesta caixa.
        //
        // Isto estava errado de uma forma que só o histórico revelava: a
        // direção era decidida pelo NOME DO CAMPO do webhook, não por quem
        // escreveu cada mensagem. No `history`, `doTelemovel` é sempre falso,
        // por isso TODAS as mensagens antigas entravam como recebidas — e as
        // que a empresa tinha enviado ficavam com o próprio número da empresa
        // como contacto, criando uma conversa da empresa consigo mesma e
        // partindo metade de cada diálogo. O histórico é precisamente aquilo
        // para que serve a Coexistence.
        //
        // Compara-se por dígitos: o `display_phone_number` vem com sinais e
        // espaços ("+351 912 …") e o `wa_id` vem só com números.
        const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
        const nossos = new Set(
          [
            value?.metadata?.display_phone_number,
            channel.phone_number,
            (channel.metadata as { display_phone_number?: string } | null)?.display_phone_number,
          ].map(soDigitos).filter(Boolean),
        );
        const ehNosso = (v: unknown) => {
          const d = soDigitos(v);
          return !!d && nossos.has(d);
        };

        // Os ecos vêm em `message_echoes`; o histórico em `history`, agrupado
        // por conversa. Ler só `messages` deixava cair os ecos inteiros — o
        // CRM ficava a ver metade do diálogo e ninguém percebia porquê.
        const lotes = value.message_echoes ?? value.messages ?? value.history ?? [];
        for (const fio of lotes) {
          const lista = fio?.messages ?? [fio];
          for (const msg of lista) {
            try {
              // Por mensagem, e não por campo: num mesmo lote de histórico há
              // as duas direções.
              const saida = ehNosso(msg.from);
              await guardarWhatsApp(supabase, channel, msg, {
                contraparte: saida
                  ? String(msg.to ?? msg.recipient_id ?? "")
                  : String(msg.from ?? ""),
                saida,
                // Histórico não notifica: são mensagens de há dias, e avisar
                // delas seria tocar o telemóvel centenas de vezes de uma vez.
                notificar: false,
                nomes: new Map(),
              });
            } catch (e) {
              logError("mensagem de coexistência ignorada", { error: (e as Error).message });
            }
          }
        }
        resultado = change.field;
        continue;
      }

      if (change.field === "smb_app_state_sync") {
        // Contactos: só o nome interessa, para a conversa deixar de ser um número.
        for (const c of value.state_sync ?? []) {
          const numero = String(c?.contact?.phone_number ?? c?.phone_number ?? "");
          const nome = c?.contact?.full_name ?? c?.full_name ?? null;
          if (!numero || !nome) continue;
          await supabase.from("meta_conversations")
            .update({ contact_name: nome })
            .eq("channel_id", channel.id)
            .eq("contact_ref", numero)
            .is("contact_name", null);
        }
        resultado = "contactos";
        continue;
      }

      // ── Estados de entrega ────────────────────────────────────────────────
      for (const st of value.statuses ?? []) {
        try {
          const agora = st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : null;
          const patch: Record<string, unknown> = { delivery_status: st.status };
          if (st.status === "delivered") patch.delivered_at = agora;
          if (st.status === "read") patch.read_at = agora;
          if (st.status === "failed") {
            const e = (st.errors ?? [])[0];
            patch.delivery_error = e ? `${e.code ?? ""} ${e.title ?? e.message ?? ""}`.trim() : "falhou";
          }
          await supabase.from("meta_messages").update(patch)
            .eq("organization_id", channel.organization_id)
            .eq("external_id", st.id);
        } catch (e) {
          logError("estado não gravado", { error: (e as Error).message });
        }
      }
      if ((value.statuses ?? []).length > 0) resultado = "estado";

      // ── Mensagens recebidas ───────────────────────────────────────────────
      const nomePorNumero = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c?.wa_id && c?.profile?.name) nomePorNumero.set(String(c.wa_id), String(c.profile.name));
      }

      for (const msg of value.messages ?? []) {
        try {
          const de = String(msg.from ?? "");
          if (!de) continue;

          // Reação: não é mensagem nova, anota-se na mensagem reagida.
          if (msg.type === "reaction" && msg.reaction?.message_id) {
            await supabase.from("meta_messages").update({
              reaction: msg.reaction.emoji || null,
              reaction_by: msg.reaction.emoji ? "contact" : null,
            })
              .eq("organization_id", channel.organization_id)
              .eq("external_id", msg.reaction.message_id);
            resultado = "reacao";
            continue;
          }

          resultado = await guardarWhatsApp(supabase, channel, msg, {
            contraparte: de,
            saida: false,
            notificar: true,
            nomes: nomePorNumero,
          });
        } catch (e) {
          logError("mensagem WhatsApp ignorada por erro", { error: (e as Error).message });
          resultado = "erro";
        }
      }
    }
  }

  return { resultado, phoneNumberId, orgId };
}

/**
 * Guarda uma mensagem de WhatsApp na conversa certa.
 *
 * Serve os três caminhos — o que entra agora, o histórico dos 180 dias, e os
 * ecos do que o dono escreve pelo telemóvel — porque a diferença entre eles é
 * só de QUEM é a contraparte e se notifica. Ter isto escrito uma vez é o que
 * evita que o espelho e o tempo real se comportem de maneira diferente.
 */
async function guardarWhatsApp(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  channel: { id: string; organization_id: string; assigned_user_ids?: string[] | null },
  // deno-lint-ignore no-explicit-any
  msg: any,
  opts: {
    /** O outro lado da conversa — nunca nós. */
    contraparte: string;
    /** A mensagem foi escrita por nós (eco do telemóvel)? */
    saida: boolean;
    notificar: boolean;
    nomes: Map<string, string>;
  },
): Promise<string> {
  const { contraparte, saida } = opts;
  if (!contraparte) return "sem_contraparte";

  const at = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();
  const { texto, anexos } = conteudoWhatsApp(msg);
  if (!texto && anexos.length === 0) return "vazia";

  const resumo = texto || `[${anexos[0]?.type ?? "anexo"}]`;
  const janela = new Date(at.getTime() + REPLY_WINDOW_MS).toISOString();

  const { data: existente } = await supabase
    .from("meta_conversations")
    .select("id, contact_name, last_message_at, window_expires_at")
    .eq("channel_id", channel.id)
    .eq("contact_ref", contraparte)
    .maybeSingle();

  // O nome vem na própria mensagem — nada de pedido extra de perfil.
  const nome = opts.nomes.get(contraparte) ?? existente?.contact_name ?? null;

  let convId: string;
  if (existente) {
    const maisRecente = !existente.last_message_at
      || new Date(existente.last_message_at) <= at;
    const { data, error } = await supabase.from("meta_conversations").update({
      ...(maisRecente ? { last_message: resumo, last_message_at: at.toISOString() } : {}),
      // Só uma mensagem DA PESSOA reabre a janela de 24h. Um eco nosso não —
      // responder não compra mais tempo, e fingir que sim deixava o compositor
      // aberto para um envio que a Meta ia recusar.
      ...(saida ? {} : {
        window_expires_at: existente.window_expires_at && existente.window_expires_at > janela
          ? existente.window_expires_at : janela,
      }),
      ...(nome && !existente.contact_name ? { contact_name: nome } : {}),
      status: "open",
      updated_at: new Date().toISOString(),
    }).eq("id", existente.id).select("id").single();
    if (error) { logError("conversa não atualizada", { error: error.message }); return "erro"; }
    convId = data.id;
  } else {
    const { data, error } = await supabase.from("meta_conversations").insert({
      organization_id: channel.organization_id,
      channel_id: channel.id,
      contact_ref: contraparte,
      contact_name: nome,
      last_message: resumo,
      last_message_at: at.toISOString(),
      window_expires_at: saida ? null : janela,
      status: "open",
    }).select("id").single();
    if (error) { logError("conversa não criada", { error: error.message }); return "erro"; }
    convId = data.id;
  }

  const { error: msgErr } = await supabase.from("meta_messages").insert({
    organization_id: channel.organization_id,
    conversation_id: convId,
    external_id: msg.id ?? null,
    direction: saida ? "outgoing" : "incoming",
    content: texto || null,
    reply_to_external_id: msg.context?.id ?? null,
    attachments: anexos,
    sent_at: at.toISOString(),
    // Um eco já foi entregue — foi enviado pelo telemóvel, não por nós.
    ...(saida ? { delivery_status: "sent" } : {}),
  });

  // 23505 = repetição. Os webhooks são entregues pelo menos uma vez, e o
  // histórico traz mensagens que já cá estão — repetir é o esperado, não erro.
  if (msgErr && (msgErr as { code?: string }).code !== "23505") {
    logError("mensagem WhatsApp não gravada", { error: msgErr.message });
    return "erro";
  }
  if (msgErr) return "duplicada";
  scheduleInboxTaskSuggestions(convId, texto || null, at);

  // Só o que ENTRA conta por ler. Marcar como não lida uma mensagem que o
  // próprio dono escreveu era pedir-lhe atenção para o que ele acabou de dizer.
  if (!saida) {
    await supabase.rpc("increment_meta_unread", { _conversation_id: convId })
      .then(() => {}, () => {});
    if (opts.notificar) {
      await notificar(supabase, channel, `💬 WhatsApp: ${nome || contraparte}`, resumo, convId);
    }
  }

  return "guardada";
}

/** Texto e anexos de uma mensagem do WhatsApp, por tipo. */
// deno-lint-ignore no-explicit-any
function conteudoWhatsApp(msg: any): { texto: string; anexos: Array<Record<string, unknown>> } {
  const anexos: Array<Record<string, unknown>> = [];
  let texto = "";

  switch (msg.type) {
    case "text":
      texto = msg.text?.body ?? "";
      break;
    case "image": case "video": case "audio": case "document": case "sticker": {
      const m = msg[msg.type] ?? {};
      // Atenção: o WhatsApp NÃO manda o ficheiro, manda um id. Para o ver é
      // preciso ir buscá-lo à Graph API com o token — e o endereço que ela
      // devolve expira em minutos. Guarda-se o id; o download é a pedido.
      anexos.push({ type: msg.type, media_id: m.id ?? null, url: null, mime: m.mime_type ?? null });
      texto = m.caption ?? "";
      break;
    }
    case "location":
      anexos.push({
        type: "location",
        lat: msg.location?.latitude, lng: msg.location?.longitude,
        url: msg.location?.latitude
          ? `https://maps.google.com/?q=${msg.location.latitude},${msg.location.longitude}`
          : null,
      });
      texto = msg.location?.name ?? "";
      break;
    case "contacts":
      anexos.push({ type: "contacts", url: null, dados: msg.contacts ?? [] });
      texto = (msg.contacts ?? []).map((c: { name?: { formatted_name?: string } }) =>
        c?.name?.formatted_name).filter(Boolean).join(", ");
      break;
    case "button":
      // Resposta a um botão de um modelo.
      texto = msg.button?.text ?? "";
      break;
    case "interactive":
      texto = msg.interactive?.button_reply?.title
        ?? msg.interactive?.list_reply?.title ?? "";
      break;
    default:
      // Tipos que ainda não tratamos (encomendas, sistema). Fica registo de que
      // chegou alguma coisa em vez de a mensagem desaparecer sem rasto.
      texto = `[${msg.type ?? "mensagem"}]`;
  }

  return { texto, anexos };
}

/** Aviso no telemóvel. Falhar aqui não pode impedir a mensagem de ser gravada. */
async function notificar(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  channel: { organization_id: string; assigned_user_ids?: string[] | null },
  titulo: string,
  corpo: string,
  convId: string,
): Promise<void> {
  try {
    const atendentes = Array.isArray(channel.assigned_user_ids) ? channel.assigned_user_ids : [];
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        organization_id: channel.organization_id,
        title: titulo,
        body: corpo.slice(0, 140),
        url: "/inbox",
        tag: `meta-${convId}`,
        ...(atendentes.length > 0 ? { user_ids: atendentes } : {}),
      }),
    });
  } catch (e) {
    logError("falha a notificar", { error: (e as Error).message });
  }
}

interface MetaMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    reply_to?: { mid?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  // ── Verificação do endereço ───────────────────────────────────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");

    if (mode === "subscribe" && expected && token === expected) {
      log("endereço verificado pela Meta");
      return new Response(challenge ?? "", { status: 200, headers: corsHeaders });
    }
    logError("verificação recusada", { mode, temToken: !!token, temSegredo: !!expected });
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const appSecret = Deno.env.get("FACEBOOK_APP_SECRET");
  const raw = await req.text();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!appSecret) {
    logError("FACEBOOK_APP_SECRET em falta — a recusar");
    return new Response("Not configured", { status: 500, headers: corsHeaders });
  }

  const sigOk = await signatureValid(raw, req.headers.get("x-hub-signature-256"), appSecret);

  // Regista SEMPRE que fomos chamados, mesmo quando se recusa. Sem isto, uma
  // subscrição mal configurada e uma assinatura inválida são indistinguíveis:
  // nos dois casos não aparece mensagem nenhuma e não há onde olhar.
  let logId: string | null = null;
  try {
    const { data } = await supabase.from("meta_webhook_log").insert({
      method: "POST",
      valid_sig: sigOk,
      body_head: raw.slice(0, 800),
      note: sigOk ? null : "assinatura recusada",
      outcome: sigOk ? "recebido" : "assinatura_invalida",
    }).select("id").single();
    logId = data?.id ?? null;
  } catch { /* diagnóstico não pode partir o webhook */ }

  /** Anota no registo o que aconteceu a este pedido. */
  const anotar = async (campos: Record<string, unknown>) => {
    if (!logId) return;
    await supabase.from("meta_webhook_log").update(campos).eq("id", logId)
      .then(() => {}, () => {});
  };

  if (!sigOk) {
    logError("assinatura inválida — pedido recusado");
    return new Response("Invalid signature", { status: 401, headers: corsHeaders });
  }

  // A partir daqui responde-se SEMPRE 200. A Meta reentrega em qualquer outro
  // código e, se o nosso lado tiver um bug, uma reentrega infinita é pior do que
  // uma mensagem perdida — o erro fica nos logs, que é onde se vai procurar.
  let resultado = "sem_eventos";
  let orgVista: string | null = null;
  let paginaVista: string | null = null;

  try {
    const body = JSON.parse(raw);
    // A Meta diz-nos qual dos dois produtos é: "instagram" ou "page". Sem isto
    // o encaminhamento adivinhava, e uma Página ligada às duas caixas (Instagram
    // e Messenger são linhas separadas com o mesmo page_id) recebia as mensagens
    // do Messenger na caixa do Instagram — ao acaso, conforme a ordem em que o
    // Postgres devolvesse as linhas.
    const ehInstagram = body.object === "instagram";

    // O WhatsApp fala outra língua. Onde o Instagram e o Messenger mandam
    // `entry[].messaging[]`, ele manda `entry[].changes[].value` — com as
    // mensagens, os contactos e os estados de entrega em listas separadas.
    // Tentar tratá-los no mesmo ciclo dava um emaranhado de condições; tem
    // caminho próprio.
    if (body.object === "whatsapp_business_account") {
      const r = await processarWhatsApp(supabase, body);
      await anotar({
        outcome: r.resultado,
        page_id: r.phoneNumberId,
        organization_id: r.orgId,
        body_head: raw.slice(0, 200).replace(/"body":"[^"]*"/g, '"body":"[removido]"'),
      });
      return new Response("EVENT_RECEIVED", { status: 200, headers: corsHeaders });
    }

    for (const entry of body.entry ?? []) {
      // `messaging` no Messenger; o Instagram usa a mesma forma. `standby` é
      // outra coisa: significa que OUTRA app tem o controlo da conversa.
      const emStandby = !entry.messaging && !!entry.standby;
      const events: MetaMessaging[] = entry.messaging ?? entry.standby ?? [];

      for (const ev of events) {
        // Uma entrega da Meta traz vários eventos, e podem ser de PÁGINAS —
        // logo, de ORGANIZAÇÕES — diferentes. Antes, um erro em qualquer um
        // abortava o resto do lote; e como respondemos sempre 200, a Meta nunca
        // reentregava. Um cliente perdia mensagens por causa de outro.
        try {
          // `is_echo` são as nossas próprias mensagens devolvidas pela Meta.
          // Guardá-las duplicaria tudo o que enviamos.
          if (ev.message?.is_echo) continue;

          const senderId = ev.sender?.id;
          const pageId = String(entry.id ?? ev.recipient?.id ?? "");
          if (!senderId || !pageId) continue;
          paginaVista = pageId;

          // Que caixa é esta? No Instagram o `entry.id` é o id da CONTA
          // (ig_account_id); no Messenger é o id da PÁGINA.
          //
          // Isto era um `.or("metadata->>page_id.eq.X,metadata->>ig_account_id.eq.X")`
          // — e falhava em silêncio. O erro do PostgREST nem era verificado, por
          // isso o canal vinha nulo, o evento era descartado como "página que não
          // temos ligada", e ficava uma mensagem real perdida sem rasto.
          const findChannel = async (col: "ig_account_id" | "page_id", tipo?: string) => {
            let q = supabase
              .from("messaging_channels")
              // assigned_user_ids: quem atende esta caixa. Vazio = a organização
              // toda. É o que decide a quem toca o telemóvel.
              .select("id, organization_id, channel_type, metadata, assigned_user_ids, label")
              .eq(`metadata->>${col}`, pageId)
              // Arquivada = já não recebe. Com uma arquivada e outra viva para
              // a mesma Página, o `.limit(1)` escolhia ao acaso.
              .is("archived_at", null);
            if (tipo) q = q.eq("channel_type", tipo);
            const { data, error } = await q.limit(1).maybeSingle();
            if (error) logError(`procura de canal por ${col} falhou`, { error: error.message });
            return data;
          };

          const channel = ehInstagram
            ? (await findChannel("ig_account_id", "instagram") ?? await findChannel("page_id", "instagram"))
            : await findChannel("page_id", "facebook");

          if (!channel) {
            log("evento para uma página que não temos ligada", { pageId, objeto: body.object });
            resultado = "sem_canal";
            continue;
          }
          orgVista = channel.organization_id;

          // Reação a uma mensagem nossa. Não é mensagem nova — anota-se na
          // mensagem reagida, para aparecer colada a ela como no Instagram.
          //
          // Fica DEPOIS de encontrar o canal, e limitada à organização dele: em
          // cima e sem filtro, um evento de reação de uma Página que nem sequer
          // temos ligada escrevia na base de dados de qualquer cliente.
          const reac = (ev as { reaction?: { mid?: string; emoji?: string; action?: string } }).reaction;
          if (reac?.mid) {
            const { error } = await supabase.from("meta_messages")
              .update({
                reaction: reac.action === "unreact" ? null : (reac.emoji ?? "❤️"),
                reaction_by: reac.action === "unreact" ? null : "contact",
              })
              .eq("organization_id", channel.organization_id)
              .eq("external_id", reac.mid);
            if (error) logError("falha a gravar a reação", { error: error.message });
            else log("reação recebida", { mid: reac.mid, emoji: reac.emoji, action: reac.action });
            resultado = "reacao";
            continue;
          }

          // Mensagem apagada pela pessoa. Vinha sem texto e sem anexos, por isso
          // era descartada — e ficava visível no CRM para sempre, depois de o
          // cliente a ter retirado. O agente respondia a algo que já não existe.
          const apagada = (ev.message as { is_deleted?: boolean } | undefined)?.is_deleted;
          if (apagada && ev.message?.mid) {
            await supabase.from("meta_messages")
              .update({ content: null, attachments: [], is_deleted: true })
              .eq("organization_id", channel.organization_id)
              .eq("external_id", ev.message.mid);
            log("mensagem apagada pelo contacto", { mid: ev.message.mid });
            resultado = "apagada";
            continue;
          }

          const text = ev.message?.text ?? "";
          const attachments = (ev.message?.attachments ?? []).map((a) => ({
            type: a.type ?? "file",
            url: a.payload?.url ?? null,
          }));
          if (!text && attachments.length === 0) continue;

          const at = ev.timestamp ? new Date(ev.timestamp) : new Date();
          const resumo = text || `[${attachments[0]?.type ?? "anexo"}]`;
          const janelaNova = new Date(at.getTime() + REPLY_WINDOW_MS).toISOString();

          // Resposta a um story: a Meta manda o story em `reply_to.story`, não
          // como anexo. Sem isto o agente via "adorei isto!" sem saber a quê.
          const story = (ev.message as {
            reply_to?: { story?: { url?: string; id?: string } };
          } | undefined)?.reply_to?.story;
          if (story?.url) {
            attachments.unshift({ type: "story_reply", url: story.url });
          }

          // De onde veio esta conversa: anúncio, link ig.me com ?ref=, botão.
          const ref = (ev as {
            message?: { referral?: Record<string, unknown> };
            referral?: Record<string, unknown>;
          }).message?.referral ?? (ev as { referral?: Record<string, unknown> }).referral;

          // A conversa: lê-se antes de escrever para não ANDAR PARA TRÁS. Um
          // upsert cego reescrevia `window_expires_at` com o valor de uma
          // mensagem mais antiga reentregue fora de ordem — e encurtava a janela
          // de resposta sem razão nenhuma.
          const { data: existente } = await supabase
            .from("meta_conversations")
            .select("id, contact_name, last_message_at, window_expires_at")
            .eq("channel_id", channel.id)
            .eq("contact_ref", senderId)
            .maybeSingle();

          let conv: { id: string; contact_name: string | null } | null = null;

          if (existente) {
            const maisRecente = !existente.last_message_at
              || new Date(existente.last_message_at) <= at;
            const janela = existente.window_expires_at && existente.window_expires_at > janelaNova
              ? existente.window_expires_at
              : janelaNova;
            const { data, error } = await supabase.from("meta_conversations").update({
              ...(maisRecente ? { last_message: resumo, last_message_at: at.toISOString() } : {}),
              // Cada mensagem da pessoa reabre a janela de 24 horas.
              window_expires_at: janela,
              status: "open",
              updated_at: new Date().toISOString(),
            }).eq("id", existente.id).select("id, contact_name").single();
            if (error) { logError("falha a atualizar a conversa", { error: error.message }); continue; }
            conv = data;
          } else {
            const { data, error } = await supabase.from("meta_conversations").insert({
              organization_id: channel.organization_id,
              channel_id: channel.id,
              contact_ref: senderId,
              last_message: resumo,
              last_message_at: at.toISOString(),
              window_expires_at: janelaNova,
              status: "open",
              ...(ref ? { source_ref: ref } : {}),
            }).select("id, contact_name").single();
            if (error) { logError("falha a criar a conversa", { error: error.message }); continue; }
            conv = data;
          }

          if (!conv) continue;
          // Guardado à parte porque o bloco do perfil pode descobri-lo já a
          // seguir, e o aviso no telemóvel deve dizer o nome, não o número.
          let nomeContacto: string | null = conv.contact_name;
          if (emStandby) {
            // Outra app (a Caixa de Entrada da Meta, por exemplo) tem o controlo
            // desta conversa. Guarda-se a mensagem, mas responder daqui falha ou
            // duplica a resposta — por isso fica marcado.
            await supabase.from("meta_conversations")
              .update({ status: "standby" }).eq("id", conv.id);
          }

          // Nome e foto de quem escreveu.
          //
          // A Meta não os manda no webhook — só o identificador. Sem este pedido
          // extra a conversa aparece como "682024387765816", que não diz nada a
          // quem tem de responder.
          //
          // Só se pede uma vez, quando ainda não temos nome: é uma chamada por
          // contacto novo, não por mensagem.
          if (!conv.contact_name) {
            // O token vive em messaging_channel_secrets, fora do alcance do cliente.
            const { data: sec } = await supabase
              .from("messaging_channel_secrets")
              .select("page_access_token")
              .eq("channel_id", channel.id)
              .maybeSingle();
            const pageToken = sec?.page_access_token;
            if (pageToken) {
              try {
                // Os campos NÃO são os mesmos nos dois canais. `username`,
                // `follower_count` e companhia só existem no Instagram — pedi-los
                // a um PSID do Messenger faz a Graph API rejeitar o pedido
                // INTEIRO ("nonexisting field"), e a conversa ficava com o
                // número em vez do nome, sem se perceber porquê.
                const campos = ehInstagram
                  ? "name,username,profile_pic,follower_count,is_verified_user,is_user_follow_business"
                  : "name,first_name,last_name,profile_pic";
                const profRes = await fetch(
                  `https://graph.facebook.com/v21.0/${senderId}`
                  + `?fields=${campos}`
                  + `&access_token=${encodeURIComponent(pageToken)}`,
                );
                const prof = profRes.ok ? await profRes.json() : {};
                const temPerfil = profRes.ok && !prof?.error;

                // No Messenger não há @: usa-se o nome, ou o primeiro e último
                // se a Meta só devolver esses.
                let nome: string | null = temPerfil
                  ? (prof.username
                    ? `@${prof.username}`
                    : (prof.name
                      || [prof.first_name, prof.last_name].filter(Boolean).join(" ")
                      || null))
                  : null;

                // Sem perfil, tenta-se a API de conversas. É o caso NORMAL para
                // clientes reais enquanto a app não tiver a App Review: a API de
                // perfil só serve quem tem cargo na app.
                if (!nome) {
                  nome = await nomePelaConversa(
                    ehInstagram ? (channel.metadata as { page_id?: string } | null)?.page_id ?? pageId : pageId,
                    senderId,
                    ehInstagram,
                    pageToken,
                  ).catch(() => null);
                }

                if (nome || temPerfil) {
                  await supabase.from("meta_conversations").update({
                    contact_name: nome,
                    // Atenção: este endereço é assinado e EXPIRA. Guarda-se para
                    // ter foto já; quando deixar de abrir, basta limpar o nome
                    // que o próximo webhook volta a pedir os dois.
                    contact_avatar_url: temPerfil ? (prof.profile_pic ?? null) : null,
                    contact_meta: {
                      follower_count: prof.follower_count ?? null,
                      is_verified: prof.is_verified_user ?? null,
                      follows_us: prof.is_user_follow_business ?? null,
                      // Sem perfil não há fotografia: a Meta serve a silhueta
                      // genérica. Fica registado para a interface poder explicar
                      // porquê em vez de mostrar um vazio.
                      perfil_indisponivel: !temPerfil,
                    },
                  }).eq("id", conv.id);
                  nomeContacto = nome ?? nomeContacto;
                  log("nome obtido", { senderId, nome, viaPerfil: temPerfil });
                } else {
                  // Nem a API de perfil nem a de conversas deram nome. Raro — a
                  // conversa funciona à mesma, só sem ele.
                  log("sem nome por nenhuma das vias", { senderId, erro: prof?.error?.message });
                }
              } catch (e) {
                log("falha a obter o perfil", { senderId, error: (e as Error).message });
              }
            }
          }

          const { error: msgErr } = await supabase.from("meta_messages").insert({
            organization_id: channel.organization_id,
            conversation_id: conv.id,
            external_id: ev.message?.mid ?? null,
            direction: "incoming",
            content: text || null,
            // A que mensagem esta responde, quando é uma resposta.
            reply_to_external_id: ev.message?.reply_to?.mid ?? null,
            attachments,
            // Quando a Meta diz que foi enviada, não quando chegou aqui: uma
            // reentrega atrasada aparecia no fim da conversa, fora de ordem.
            sent_at: at.toISOString(),
          });

          // 23505 = já existe. Os webhooks são entregues pelo menos uma vez, por
          // isso repetições são NORMAIS — o índice único faz o seu trabalho e não
          // há nada a assinalar.
          if (msgErr && (msgErr as { code?: string }).code !== "23505") {
            logError("falha a gravar a mensagem", { error: msgErr.message });
            resultado = "erro";
            continue;
          }

          if (!msgErr) {
            await supabase.rpc("increment_meta_unread", { _conversation_id: conv.id })
              .then(() => {}, () => {
                // Sem a função, o contador fica na mesma — a mensagem é o que
                // importa e já está guardada.
              });

            // Aviso no telemóvel.
            //
            // Sem isto, uma DM chegava e NADA o dizia a ninguém: nem o menu, nem
            // o telemóvel. A equipa só descobria abrindo a caixa. Numa caixa em
            // que a janela de resposta são 24 horas, isso é a diferença entre
            // responder e nunca mais poder responder.
            //
            // Depois do insert, de propósito: avisar de uma mensagem que não
            // ficou guardada mandaria a pessoa abrir uma conversa onde não está
            // nada. Falhar aqui não pode partir o webhook — a mensagem já está
            // segura, e é isso que interessa.
            try {
              const quem = nomeContacto || "Novo contacto";
              const titulo = channel.channel_type === "instagram"
                ? `📷 Instagram: ${quem}`
                : `💬 Messenger: ${quem}`;

              // Só a quem atende esta caixa; vazia, toca a toda a organização.
              const atendentes = Array.isArray(channel.assigned_user_ids)
                ? channel.assigned_user_ids : [];

              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  organization_id: channel.organization_id,
                  title: titulo,
                  body: resumo.slice(0, 140),
                  url: "/inbox",
                  // Um aviso por conversa: uma mensagem nova substitui a
                  // anterior em vez de empilhar dez.
                  tag: `meta-${conv.id}`,
                  ...(atendentes.length > 0 ? { user_ids: atendentes } : {}),
                }),
              });
            } catch (e) {
              logError("falha a notificar", { conversa: conv.id, error: (e as Error).message });
            }

            log("mensagem guardada", { canal: channel.channel_type, conversa: conv.id });
            resultado = "guardada";
          } else {
            resultado = "duplicada";
          }
        } catch (e) {
          // Só este evento se perde. Os outros do mesmo lote — que podem ser de
          // outros clientes — seguem em frente.
          logError("evento ignorado por erro", { error: (e as Error).message });
          resultado = "erro";
        }
      }
    }
  } catch (e) {
    logError("erro a processar", { error: (e as Error).message });
    resultado = "erro";
  }

  await anotar({
    outcome: resultado,
    page_id: paginaVista,
    organization_id: orgVista,
    // O corpo bruto tem o texto das mensagens dos clientes. Depois de a
    // assinatura estar validada e o evento processado, deixa de fazer falta —
    // e sem isto o registo de diagnóstico era um arquivo permanente de dados
    // pessoais de várias organizações, fora do alcance do pedido de eliminação.
    body_head: raw.slice(0, 200).replace(/"text":"[^"]*"/g, '"text":"[removido]"'),
  });

  return new Response("EVENT_RECEIVED", { status: 200, headers: corsHeaders });
});
