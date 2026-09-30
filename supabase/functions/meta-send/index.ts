import { requestMfaResponse } from "../_shared/user-authorization.ts";
// meta-send — responde a uma conversa de Instagram ou Messenger.
//
// O envio tem de ser no servidor: o token da Página nunca pode chegar ao
// browser. Quem o tiver pode ler e enviar mensagens em nome da empresa.
//
// A janela das 24 horas é verificada ANTES de tentar. A Meta recusa envios fora
// dela com um erro genérico (#10 / "outside allowed window") que não diz o que
// realmente se passa; vale mais devolver uma frase que se entende.

import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v21.0";

const log = (s: string, d?: unknown) =>
  console.log(`[META-SEND] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);
const logError = (s: string, d?: unknown) =>
  console.error(`[META-SEND] ERROR ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

/**
 * O emoji que mostramos → a palavra que a Meta exige.
 *
 * A API não aceita emojis: `reaction: "❤️"` devolve o erro #100. E o Instagram
 * só reconhece `love` — as outras seis existem só no Messenger.
 */
const REACOES_META: Record<string, string> = {
  "❤️": "love",
  "😂": "smile",
  "😮": "wow",
  "😢": "sad",
  "😡": "angry",
  "👍": "like",
  "👎": "dislike",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Envio pelo WhatsApp Cloud API.
 *
 * O que muda em relação ao Instagram e ao Messenger, e porque é que justifica
 * função própria:
 *
 *  - O endereço é `/{phone-number-id}/messages`, não `/{page-id}/messages`.
 *  - Todo o corpo leva `messaging_product: "whatsapp"` e um `type` explícito.
 *  - O destinatário é o NÚMERO (`to`), não um `recipient.id`.
 *  - As reações levam o EMOJI a sério — ao contrário do Instagram, que só
 *    aceita a palavra "love". Tirar a reação é mandar emoji vazio.
 *  - Texto e anexo continuam a não poder ir juntos, mas o anexo aceita legenda
 *    (`caption`), o que dá quase no mesmo.
 *  - Não há indicador de "a escrever": a API não o expõe.
 */
// deno-lint-ignore no-explicit-any
async function enviarWhatsApp(p: any): Promise<Response> {
  const {
    admin, conv, channel, token, numeroId,
    text, temTexto, attachment_url, attachment_type, action,
    message_external_id, reaction, reply_to_mid, userId, template,
  } = p;

  // "A escrever" e "visto" não existem nesta API. Devolve-se sucesso em vez de
  // um erro: é a interface a pedir algo que este canal não tem, não uma falha.
  if (action === "typing_on" || action === "typing_off") {
    return json({ success: true, ignorado: "o WhatsApp não expõe o indicador de escrita" });
  }

  let corpo: Record<string, unknown>;

  if (action === "mark_seen") {
    if (!message_external_id) return json({ error: "message_external_id em falta" }, 400);
    corpo = { messaging_product: "whatsapp", status: "read", message_id: message_external_id };
  } else if (action === "react" || action === "unreact") {
    if (!message_external_id) return json({ error: "message_external_id em falta" }, 400);
    corpo = {
      messaging_product: "whatsapp",
      to: conv.contact_ref,
      type: "reaction",
      // Emoji vazio = retirar a reação. É assim que a API o diz.
      reaction: { message_id: message_external_id, emoji: action === "react" ? (reaction || "❤️") : "" },
    };
  } else if (action === "send_template") {
    /**
     * Modelo aprovado — a única mensagem que a Meta aceita fora das 24 horas.
     *
     * O formato é rígido e a Meta não perdoa: os parâmetros vão POR
     * COMPONENTE (cabeçalho, corpo) e PELA ORDEM das variáveis do modelo
     * ({{1}}, {{2}}, …). Um parâmetro a mais ou a menos e a resposta é o
     * #132000, que diz "number of parameters does not match" e mais nada.
     */
    if (!template?.name || !template?.language) {
      return json({ error: "Modelo sem nome ou sem idioma." }, 400);
    }

    const parametros = (vs: unknown): Array<Record<string, unknown>> =>
      (Array.isArray(vs) ? vs : []).map((v) => ({ type: "text", text: String(v ?? "") }));

    const componentes: Array<Record<string, unknown>> = [];
    const cab = parametros(template.variables?.header);
    if (cab.length) componentes.push({ type: "header", parameters: cab });
    const corpoVars = parametros(template.variables?.body);
    if (corpoVars.length) componentes.push({ type: "body", parameters: corpoVars });

    corpo = {
      messaging_product: "whatsapp",
      to: conv.contact_ref,
      type: "template",
      template: {
        name: String(template.name),
        language: { code: String(template.language) },
        ...(componentes.length ? { components: componentes } : {}),
      },
    };
  } else if (attachment_url) {
    const tipo = ["image", "video", "audio", "document"].includes(String(attachment_type))
      ? String(attachment_type) : "document";
    corpo = {
      messaging_product: "whatsapp",
      to: conv.contact_ref,
      type: tipo,
      [tipo]: {
        link: attachment_url,
        // Só a imagem, o vídeo e o documento aceitam legenda.
        ...(temTexto && tipo !== "audio" ? { caption: String(text) } : {}),
      },
      ...(reply_to_mid ? { context: { message_id: reply_to_mid } } : {}),
    };
  } else {
    corpo = {
      messaging_product: "whatsapp",
      to: conv.contact_ref,
      type: "text",
      text: { body: String(text), preview_url: true },
      ...(reply_to_mid ? { context: { message_id: reply_to_mid } } : {}),
    };
  }

  const res = await fetch(`${GRAPH}/${numeroId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  });
  const resposta = await res.json().catch(() => ({}));

  if (!res.ok || resposta?.error) {
    logError("o WhatsApp recusou o envio", { status: res.status, resposta });
    const e = resposta?.error;
    // 131047 = passaram as 24h e só um modelo aprovado serve. É o erro mais
    // comum desta API e o mais críptico — vale a pena traduzi-lo.
    const msg = e?.code === 131047 || /24 hours|re-engagement/i.test(e?.message ?? "")
      ? "Passaram mais de 24 horas desde a última mensagem desta pessoa. "
        + "Fora desse prazo o WhatsApp só permite enviar um modelo aprovado pela Meta."
      // Os dois erros de modelo que aparecem a sério, e que a mensagem crua da
      // Meta não explica a ninguém.
      : e?.code === 132000
      ? "O número de campos preenchidos não corresponde ao que o modelo espera. "
        + "Sincroniza os modelos e tenta outra vez."
      : e?.code === 132001 || e?.code === 132015
      ? "Este modelo não está aprovado (ou foi pausado) para este idioma. "
        + "Escolhe outro, ou confirma o estado no painel da Meta."
      : (e?.message ?? `O WhatsApp recusou o envio (${res.status})`);
    return json({ error: msg, code: e?.code ?? null }, 502);
  }

  if (action === "mark_seen") return json({ success: true });

  if (action === "react" || action === "unreact") {
    await admin.from("meta_messages").update({
      reaction: action === "react" ? (reaction || "❤️") : null,
      reaction_by: action === "react" ? "agent" : null,
    })
      .eq("conversation_id", conv.id)
      .eq("external_id", message_external_id);
    return json({ success: true });
  }

  const wamid = resposta?.messages?.[0]?.id ?? null;

  // O que fica escrito na conversa.
  //
  // Num modelo não há `text`: o que se manda é o nome do modelo e as variáveis.
  // O compositor envia o `preview` — o corpo já com as variáveis preenchidas —
  // porque é isso que a pessoa do outro lado vai ler, e é isso que o agente
  // tem de ver aqui daqui a três dias.
  const textoModelo = action === "send_template"
    ? String(template?.preview ?? `[modelo: ${template?.name ?? "?"}]`)
    : null;
  const resumo = textoModelo ?? (temTexto ? String(text) : `[${attachment_type || "anexo"}]`);

  const { error: insErr } = await admin.from("meta_messages").insert({
    organization_id: conv.organization_id,
    conversation_id: conv.id,
    external_id: wamid,
    direction: "outgoing",
    content: textoModelo ?? (temTexto ? String(text) : null),
    reply_to_external_id: reply_to_mid ?? null,
    attachments: attachment_url ? [{ type: attachment_type || "document", url: attachment_url }] : [],
    sent_by: userId,
    sent_at: new Date().toISOString(),
    // O estado real chega depois, por webhook: entregue, lida ou falhada.
    delivery_status: "sent",
  });
  if (insErr) {
    logError("ENTREGUE MAS NÃO GUARDADA", { conversa: conv.id, wamid, error: insErr.message });
  }

  await admin.from("meta_conversations").update({
    last_message: resumo,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", conv.id);

  log("WhatsApp enviado", { conversa: conv.id, canal: channel?.label });
  return json({ success: true, stored: !insErr, message_id: wamid });
}

/**
 * Envio por um número de WhatsApp ligado por QR code (Evolution).
 *
 * O que muda em relação à Cloud API:
 *
 *  - Não há janela de 24h nem modelos: é o WhatsApp do próprio telemóvel,
 *    responde quando quiser. `send_template` é recusado com uma frase clara.
 *  - O destinatário é o número em dígitos, ou o `…@lid` quando o WhatsApp não
 *    revelou o número. O Evolution aceita os dois.
 *  - Reações, respostas citadas e "visto" precisam da CHAVE da mensagem
 *    (conversa + quem a escreveu + id), não só do id. A conversa é sempre
 *    esta, e quem a escreveu vem da direção guardada.
 *  - O "a escrever" existe (a Cloud API não o tem).
 *
 * A mensagem enviada também volta pelo evolution-webhook. O índice único
 * (conversa, external_id) faz da segunda gravação uma repetição inofensiva —
 * chegue ela antes ou depois desta.
 */
// deno-lint-ignore no-explicit-any
async function enviarEvolution(p: any): Promise<Response> {
  const {
    admin, conv, channel, text, temTexto, attachment_url, attachment_type, action,
    message_external_id, reaction, reply_to_mid, userId,
  } = p;

  const base = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
  const apikey = Deno.env.get("EVOLUTION_API_KEY") || "";
  const instancia = channel?.evolution_instance as string | null;
  if (!base || !apikey || !instancia) {
    return json({ error: "Esta caixa não tem ligação ao WhatsApp — volta a ligá-la por QR code." }, 400);
  }

  const numero = String(conv.contact_ref);
  const jid = numero.includes("@") ? numero : `${numero}@s.whatsapp.net`;
  const evo = (caminho: string, corpo: unknown) =>
    fetch(`${base}${caminho}/${instancia}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(30_000),
    });

  // A chave de uma mensagem desta conversa, para reagir ou citar.
  const chaveDe = async (externalId: string) => {
    const { data } = await admin.from("meta_messages")
      .select("direction, content")
      .eq("conversation_id", conv.id)
      .eq("external_id", externalId)
      .maybeSingle();
    return {
      key: { remoteJid: jid, fromMe: data?.direction === "outgoing", id: externalId },
      content: (data?.content as string | null) ?? "",
    };
  };

  // Sinais. Falhar aqui não é erro de ninguém — não se mostra.
  if (action === "typing_on" || action === "typing_off") {
    await evo("/chat/sendPresence", {
      number: numero, presence: action === "typing_on" ? "composing" : "paused", delay: 3000,
    }).catch(() => {});
    return json({ success: true });
  }
  if (action === "mark_seen") {
    const { data: recebidas } = await admin.from("meta_messages")
      .select("external_id")
      .eq("conversation_id", conv.id)
      .eq("direction", "incoming")
      .not("external_id", "is", null)
      .order("sent_at", { ascending: false })
      .limit(20);
    const ids = (recebidas ?? []).map((r: { external_id: string }) => r.external_id);
    if (ids.length) {
      await evo("/chat/markMessageAsRead", {
        readMessages: ids.map((id: string) => ({ remoteJid: jid, fromMe: false, id })),
      }).catch(() => {});
    }
    return json({ success: true });
  }
  if (action === "send_template") {
    return json({
      error: "Os modelos da Meta não se aplicam a números ligados por QR code. Escreve a mensagem normalmente.",
    }, 400);
  }

  const falhou = async (res: Response) => {
    const corpo = await res.json().catch(() => ({}));
    logError("o Evolution recusou o envio", { status: res.status, corpo });
    const detalhe = corpo?.response?.message;
    // Número que não tem WhatsApp: o Evolution devolve [{ exists: false }].
    if (Array.isArray(detalhe) && detalhe.some((d: { exists?: boolean }) => d?.exists === false)) {
      return json({ error: "Este número não tem WhatsApp." }, 502);
    }
    if (channel?.status !== "connected" || /connection closed|not connected/i.test(JSON.stringify(corpo))) {
      return json({
        error: "O WhatsApp desta caixa está desligado. Volta a ligá-lo em Definições → Integrações.",
        code: "channel_disconnected",
      }, 409);
    }
    const msg = typeof detalhe === "string" ? detalhe
      : Array.isArray(detalhe) && typeof detalhe[0] === "string" ? detalhe[0]
      : `O WhatsApp recusou o envio (${res.status})`;
    return json({ error: msg }, 502);
  };

  if (action === "react" || action === "unreact") {
    if (!message_external_id) return json({ error: "message_external_id em falta" }, 400);
    const { key } = await chaveDe(String(message_external_id));
    const emoji = action === "react" ? (reaction || "❤️") : "";
    const res = await evo("/message/sendReaction", { key, reaction: emoji });
    if (!res.ok) return await falhou(res);
    await admin.from("meta_messages").update({
      reaction: emoji || null,
      reaction_by: emoji ? "agent" : null,
    })
      .eq("conversation_id", conv.id)
      .eq("external_id", message_external_id);
    return json({ success: true });
  }

  const citada = reply_to_mid ? await chaveDe(String(reply_to_mid)) : null;
  const quoted = citada ? { quoted: { key: citada.key, message: { conversation: citada.content } } } : {};

  const tipo = attachment_url
    ? (["image", "video", "audio"].includes(String(attachment_type)) ? String(attachment_type) : "document")
    : null;

  let res: Response;
  if (attachment_url && tipo === "audio") {
    res = await evo("/message/sendWhatsAppAudio", { number: numero, audio: attachment_url, ...quoted });
  } else if (attachment_url) {
    // O nome do ficheiro é o que a pessoa vê num documento. Vem do caminho,
    // sem o carimbo de tempo que o upload lhe acrescenta.
    const nome = decodeURIComponent(String(attachment_url).split("?")[0].split("/").pop() ?? "ficheiro")
      .replace(/^\d{10,}-/, "");
    res = await evo("/message/sendMedia", {
      number: numero,
      mediatype: tipo,
      media: attachment_url,
      fileName: nome,
      ...(temTexto ? { caption: String(text) } : {}),
      ...quoted,
    });
  } else {
    res = await evo("/message/sendText", { number: numero, text: String(text), linkPreview: true, ...quoted });
  }
  if (!res.ok) return await falhou(res);

  const resposta = await res.json().catch(() => ({}));
  const messageId = resposta?.key?.id ?? null;
  const resumo = temTexto ? String(text) : `[${tipo ?? "anexo"}]`;

  const { error: insErr } = await admin.from("meta_messages").insert({
    organization_id: conv.organization_id,
    conversation_id: conv.id,
    external_id: messageId,
    direction: "outgoing",
    content: temTexto ? String(text) : null,
    reply_to_external_id: reply_to_mid ?? null,
    attachments: attachment_url ? [{ type: tipo, url: attachment_url }] : [],
    sent_by: userId,
    sent_at: new Date().toISOString(),
    delivery_status: "sent",
  });
  // 23505: o webhook foi mais rápido e já a gravou. Falta-lhe só quem enviou.
  let guardada = !insErr;
  if (insErr && (insErr as { code?: string }).code === "23505") {
    await admin.from("meta_messages").update({ sent_by: userId })
      .eq("conversation_id", conv.id).eq("external_id", messageId);
    guardada = true;
  } else if (insErr) {
    logError("ENTREGUE MAS NÃO GUARDADA", { conversa: conv.id, messageId, error: insErr.message });
  }

  await admin.from("meta_conversations").update({
    last_message: resumo,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", conv.id);

  log("WhatsApp (QR) enviado", { conversa: conv.id, canal: channel?.label });
  return json({ success: true, stored: guardada, message_id: messageId });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Não autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Quem está a enviar. Sem isto qualquer pessoa com o endereço podia
    // responder em nome da empresa.
    const { data: { user } } = await admin.auth.getUser(bearer);
    if (!user) return json({ error: "Sessão inválida" }, 401);
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const {
      conversation_id, text,
      // Anexo por URL (a Meta vai buscá-lo, por isso tem de ser público).
      attachment_url, attachment_type,
      // "react" / "unreact" / "typing_on" / "typing_off" / "mark_seen" /
      // "send_template"
      action, message_external_id, reaction,
      // Responder A uma mensagem concreta (o `mid` dela, do lado da Meta).
      reply_to_mid,
      // Modelo aprovado, para reabrir uma conversa fora das 24 horas:
      // { name, language, variables: { body: [...], header: [...] } }
      template,
    } = await req.json().catch(() => ({}));

    const temTexto = !!String(text ?? "").trim();
    if (!conversation_id) return json({ error: "conversation_id é obrigatório" }, 400);
    if (!temTexto && !attachment_url && !action) {
      return json({ error: "Nada para enviar" }, 400);
    }
    // O limite de tamanho é verificado MAIS ABAIXO, depois de se saber qual é o
    // canal: aqui em cima aplicava-se o limite do Instagram (1000 bytes) a
    // tudo, e recusava mensagens de WhatsApp perfeitamente válidas — o WhatsApp
    // aceita 4096 caracteres — com uma frase que falava do Instagram.

    const { data: conv } = await admin
      .from("meta_conversations")
      .select("id, organization_id, channel_id, contact_ref, window_expires_at")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv) return json({ error: "Conversa não encontrada" }, 404);

    // Membro da organização da conversa? O RLS protege as leituras do cliente,
    // mas aqui corremos como service_role — a verificação é nossa.
    //
    // O parâmetro chama-se `_org_id` (não `_organization_id`): com o nome errado
    // o Postgres não encontra a função, o `data` vem nulo, e a resposta seria um
    // "Sem acesso a esta conversa" a toda a gente — um 403 a mentir sobre a causa.
    const { data: isMember, error: memberErr } = await admin.rpc("is_org_member", {
      _user_id: user.id, _org_id: conv.organization_id,
    });
    if (memberErr) {
      logError("verificação de membro falhou", { error: memberErr.message });
      return json({ error: "Não foi possível verificar o acesso" }, 500);
    }
    if (!isMember) return json({ error: "Sem acesso a esta conversa" }, 403);

    // A janela das 24h. Verificada aqui para dar uma resposta que se entende.
    // As ações de sinalização (a escrever, visto) não contam como mensagem, por
    // isso não são bloqueadas por ela.
    const acaoSinal = action === "typing_on" || action === "typing_off" || action === "mark_seen";
    // Um modelo aprovado é EXATAMENTE o que a Meta permite fora da janela — é
    // para isso que os modelos existem. Bloqueá-lo aqui era fechar a única
    // porta que estava aberta.
    const ehModelo = action === "send_template";
    if (!acaoSinal && !ehModelo
      && conv.window_expires_at && new Date(conv.window_expires_at) < new Date()) {
      return json({
        error: "Passaram mais de 24 horas desde a última mensagem desta pessoa. "
          + "A Meta só permite responder dentro desse prazo — só é possível "
          + "voltar a escrever depois de ela enviar nova mensagem.",
        code: "window_expired",
      }, 409);
    }

    // O canal TEM de pertencer à mesma organização da conversa. Sem este filtro,
    // um membro podia alterar o channel_id da sua conversa (o RLS só verifica o
    // organization_id) e passar a enviar pela Página de outra organização.
    const { data: channel } = await admin
      .from("messaging_channels")
      .select("metadata, channel_type, provider, archived_at, label, evolution_instance, status")
      .eq("id", conv.channel_id)
      .eq("organization_id", conv.organization_id)
      .maybeSingle();

    // Caixa arquivada: as conversas continuam legíveis — é o ponto de arquivar
    // em vez de apagar — mas já não se envia por ela. A subscrição na Meta foi
    // removida e o token apagado; tentar seria um erro do Graph que ninguém
    // consegue interpretar.
    if (channel?.archived_at) {
      return json({
        error: `A caixa "${channel.label ?? "desta conversa"}" está arquivada. `
          + "O histórico continua aqui, mas para voltar a responder tens de a ligar outra vez.",
        code: "channel_archived",
      }, 409);
    }
    const meta = (channel?.metadata ?? {}) as {
      page_id?: string; phone_number_id?: string; managed_by?: string; native_inbox?: boolean;
    };

    // Número ligado por QR code: não passa pela Meta, não tem token de Página
    // nem janela de 24h. Vai pelo Evolution — ver enviarEvolution.
    if (channel?.channel_type === "whatsapp" && channel.provider === "evolution" && meta.native_inbox === true) {
      if (temTexto && [...String(text)].length > 4096) {
        return json({
          error: "A mensagem excede o limite de 4096 caracteres do WhatsApp. Divide-a em duas.",
        }, 400);
      }
      return await enviarEvolution({
        admin, conv, channel, text, temTexto, attachment_url, attachment_type, action,
        message_external_id, reaction, reply_to_mid, userId: user.id,
      });
    }

    if (channel?.channel_type === "whatsapp" && channel.provider === "evolution" && meta.managed_by === "senvia_v2") {
      return json({
        error: "Este canal é gerido pela fila segura de mensagens.",
        code: "managed_channel_queue_required",
      }, 409);
    }
    // O token vive fora do metadata: aquela tabela é legível por qualquer membro.
    const { data: secret } = await admin
      .from("messaging_channel_secrets")
      .select("page_access_token")
      .eq("channel_id", conv.channel_id)
      .maybeSingle();
    const pageToken = secret?.page_access_token;

    // O WhatsApp é outro produto dentro da mesma API: outro id de origem, outro
    // endereço e outra forma de corpo. Trata-se à parte para não encher o resto
    // de condições.
    const ehWhatsApp = channel?.channel_type === "whatsapp" && !!meta.phone_number_id;

    if (!pageToken || (!meta.page_id && !meta.phone_number_id)) {
      return json({ error: "Canal sem credenciais — volta a ligar a conta." }, 400);
    }

    // O limite é DE CADA CANAL, e só se sabe qual é depois de saber qual é o
    // canal. O Instagram e o Messenger contam BYTES (1000) — um acento conta
    // por dois; o WhatsApp conta caracteres (4096).
    if (temTexto) {
      const t = String(text);
      if (ehWhatsApp && [...t].length > 4096) {
        return json({
          error: "A mensagem excede o limite de 4096 caracteres do WhatsApp. Divide-a em duas.",
        }, 400);
      }
      if (!ehWhatsApp && new TextEncoder().encode(t).length > 1000) {
        return json({
          error: "A mensagem excede o limite de 1000 bytes da Meta para este canal "
            + "(os acentos contam a dobrar). Divide-a em duas.",
        }, 400);
      }
    }

    if (ehModelo && !ehWhatsApp) {
      return json({
        error: "Os modelos de mensagem só existem no WhatsApp.",
      }, 400);
    }

    if (ehWhatsApp) {
      return await enviarWhatsApp({
        admin, conv, channel, token: pageToken, numeroId: meta.phone_number_id!,
        text, temTexto, attachment_url, attachment_type, action,
        message_external_id, reaction, reply_to_mid, userId: user.id, template,
      });
    }

    // O corpo muda conforme o que se está a fazer. Texto e anexo NÃO podem ir
    // na mesma mensagem — é limitação da Meta, não escolha nossa.
    let payload: Record<string, unknown>;
    if (acaoSinal) {
      payload = { recipient: { id: conv.contact_ref }, sender_action: action };
    } else if (action === "react" || action === "unreact") {
      if (!message_external_id) return json({ error: "message_external_id em falta" }, 400);

      if (action === "react") {
        // A Meta quer uma PALAVRA, não o emoji. Mandar "❤️" dá erro #100.
        const palavra = REACOES_META[String(reaction ?? "❤️")];
        if (!palavra) {
          return json({ error: "Reação não suportada pela Meta." }, 400);
        }
        // E no Instagram só existe uma: o coração. As outras são recusadas.
        if (channel?.channel_type === "instagram" && palavra !== "love") {
          return json({
            error: "O Instagram só permite reagir com o coração. As outras reações "
              + "existem no Messenger, não no Instagram.",
          }, 400);
        }
        payload = {
          recipient: { id: conv.contact_ref },
          sender_action: "react",
          payload: { message_id: message_external_id, reaction: palavra },
        };
      } else {
        payload = {
          recipient: { id: conv.contact_ref },
          sender_action: "unreact",
          payload: { message_id: message_external_id },
        };
      }
    } else if (attachment_url) {
      payload = {
        recipient: { id: conv.contact_ref },
        message: {
          attachment: {
            type: attachment_type || "file",
            payload: { url: attachment_url },
          },
        },
        // `reply_to` é IRMÃO de `message`, não vai lá dentro. Dentro, a Meta
        // responde #100 "Invalid keys reply_to were found in param message" e a
        // resposta simplesmente não sai.
        ...(reply_to_mid ? { reply_to: { mid: reply_to_mid } } : {}),
        messaging_type: "RESPONSE",
      };
    } else {
      payload = {
        recipient: { id: conv.contact_ref },
        message: { text: String(text) },
        ...(reply_to_mid ? { reply_to: { mid: reply_to_mid } } : {}),
        messaging_type: "RESPONSE",
      };
    }

    const res = await fetch(`${GRAPH}/${meta.page_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, access_token: pageToken }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok || body?.error) {
      logError("a Meta recusou o envio", { status: res.status, body });
      return json({
        error: body?.error?.message ?? `A Meta recusou o envio (${res.status})`,
      }, 502);
    }

    // Sinalizações (a escrever / visto) não são mensagens: não se guardam nem
    // mexem na conversa. Gravá-las poluiria a thread com linhas vazias.
    if (acaoSinal) {
      return json({ success: true });
    }

    // Reações não são mensagens novas — anotam-se na mensagem reagida.
    if (action === "react" || action === "unreact") {
      await admin.from("meta_messages")
        .update({
          reaction: action === "react" ? (reaction || "❤️") : null,
          reaction_by: action === "react" ? "agent" : null,
        })
        .eq("conversation_id", conv.id)
        .eq("external_id", message_external_id);
      log("reação registada", { conversa: conv.id, action });
      return json({ success: true });
    }

    const resumo = temTexto
      ? String(text)
      : `[${attachment_type || "anexo"}]`;

    // Guarda a mensagem enviada, para aparecer na conversa como qualquer outra.
    //
    // O erro deste insert É verificado. Neste ponto a Meta já entregou a
    // mensagem ao cliente: se a gravação falhar em silêncio, respondemos
    // `success` ao CRM, o rascunho é limpo, e fica uma mensagem que o cliente
    // recebeu e que não existe em lado nenhum do sistema — o agente reescreve-a.
    const { error: insertErr } = await admin.from("meta_messages").insert({
      organization_id: conv.organization_id,
      conversation_id: conv.id,
      external_id: body?.message_id ?? null,
      direction: "outgoing",
      content: temTexto ? String(text) : null,
      reply_to_external_id: reply_to_mid ?? null,
      attachments: attachment_url
        ? [{ type: attachment_type || "file", url: attachment_url }]
        : [],
      sent_by: user.id,
      sent_at: new Date().toISOString(),
    });

    if (insertErr) {
      logError("ENTREGUE MAS NÃO GUARDADA", {
        conversa: conv.id, message_id: body?.message_id, error: insertErr.message,
      });
    }

    const { error: convErr } = await admin.from("meta_conversations").update({
      last_message: resumo,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", conv.id);
    if (convErr) logError("falha a atualizar a conversa", { error: convErr.message });

    log("mensagem enviada", { conversa: conv.id, canal: channel?.channel_type });
    // `stored: false` diz ao CRM que a mensagem foi mesmo entregue mas não ficou
    // registada — é a diferença entre "reenvia" e "não reenvies, já foi".
    return json({ success: true, stored: !insertErr, message_id: body?.message_id ?? null });
  } catch (e) {
    logError("erro inesperado", { error: (e as Error).message });
    return json({ error: (e as Error).message }, 500);
  }
});
