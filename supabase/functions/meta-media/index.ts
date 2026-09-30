import { requestMfaResponse } from "../_shared/user-authorization.ts";
// meta-media — serve um ficheiro recebido pelo WhatsApp.
//
// PORQUE É QUE ISTO TEM DE EXISTIR
//
// O WhatsApp não manda o ficheiro no webhook: manda um `media_id`. Para o ver é
// preciso pedir o endereço à Graph API e depois descarregá-lo COM O TOKEN da
// conta — e esse endereço expira em minutos, por isso não serve de nada
// guardá-lo.
//
// Sem esta função, todas as fotografias, áudios e documentos que um cliente
// enviasse apareciam na conversa como o texto `[image]`: o webhook guardava o
// id (bem) e a interface não tinha por onde o resolver. Um cliente manda a
// fotografia de um documento e o agente vê a palavra "image".
//
// O download é feito AQUI e não no browser por uma razão que não é de
// conveniência: o token da conta nunca pode chegar ao lado do cliente. Quem o
// tiver lê e escreve mensagens em nome da empresa, para sempre.
//
// O acesso é verificado com a MESMA regra do resto da caixa
// (`pode_aceder_caixa`): pertencer à organização não chega se a caixa tiver
// atendentes definidos.

import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v21.0";

const log = (s: string, d?: unknown) =>
  console.log(`[META-MEDIA] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);
const logError = (s: string, d?: unknown) =>
  console.error(`[META-MEDIA] ERROR ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Não autorizado" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user } } = await admin.auth.getUser(bearer);
    if (!user) return json({ error: "Sessão inválida" }, 401);
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    const { message_id, media_id } = await req.json().catch(() => ({}));
    if (!message_id || !media_id) {
      return json({ error: "message_id e media_id são obrigatórios" }, 400);
    }

    // A mensagem, a conversa e a caixa — nesta ordem, porque é a caixa que
    // manda no acesso.
    const { data: msg } = await admin
      .from("meta_messages")
      .select("id, attachments, conversation_id")
      .eq("id", String(message_id))
      .maybeSingle();
    if (!msg) return json({ error: "Mensagem não encontrada" }, 404);

    const { data: conv } = await admin
      .from("meta_conversations")
      .select("id, channel_id")
      .eq("id", msg.conversation_id)
      .maybeSingle();
    if (!conv) return json({ error: "Conversa não encontrada" }, 404);

    const { data: pode, error: acessoErr } = await admin.rpc("pode_aceder_caixa", {
      _user_id: user.id, _channel_id: conv.channel_id,
    });
    if (acessoErr) {
      logError("verificação de acesso falhou", { error: acessoErr.message });
      return json({ error: "Não foi possível verificar o acesso" }, 500);
    }
    if (pode !== true) return json({ error: "Sem acesso a esta conversa" }, 403);

    // O `media_id` TEM de ser um dos anexos DESTA mensagem.
    //
    // Sem esta verificação, quem tivesse acesso a uma conversa qualquer podia
    // pedir o id de um ficheiro de outra — os ids são da Meta, não nossos, e
    // não trazem organização nenhuma agarrada.
    const anexos = (msg.attachments ?? []) as Array<{ media_id?: string; mime?: string }>;
    const anexo = anexos.find((a) => a?.media_id && String(a.media_id) === String(media_id));
    if (!anexo) return json({ error: "Esse ficheiro não pertence a esta mensagem." }, 400);

    // Número ligado por QR code: o ficheiro está no Evolution, não na Meta. O
    // `media_id` é o id da mensagem do WhatsApp, que é o que ele pede para
    // devolver os bytes.
    const { data: canal } = await admin
      .from("messaging_channels")
      .select("provider, evolution_instance, metadata")
      .eq("id", conv.channel_id)
      .maybeSingle();
    if (canal?.provider === "evolution"
      && (canal.metadata as { native_inbox?: boolean } | null)?.native_inbox === true) {
      const base = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
      const apikey = Deno.env.get("EVOLUTION_API_KEY") || "";
      if (!base || !apikey || !canal.evolution_instance) {
        return json({ error: "A caixa já não tem ligação ao WhatsApp." }, 409);
      }
      const evoRes = await fetch(`${base}/chat/getBase64FromMediaMessage/${canal.evolution_instance}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey },
        body: JSON.stringify({ message: { key: { id: String(media_id) } }, convertToMp4: false }),
        signal: AbortSignal.timeout(45_000),
      });
      const evo = await evoRes.json().catch(() => ({}));
      if (!evoRes.ok || !evo?.base64) {
        logError("o Evolution não devolveu o ficheiro", { estado: evoRes.status });
        return json({
          error: "O ficheiro já não está disponível no WhatsApp desta caixa.",
        }, 404);
      }
      const bytes = Uint8Array.from(atob(String(evo.base64)), (c) => c.charCodeAt(0));
      const tipo = String(evo.mimetype ?? anexo.mime ?? "application/octet-stream");
      log("ficheiro servido (QR)", { media_id, tipo, bytes: bytes.length });
      return new Response(bytes, {
        headers: {
          ...corsHeaders,
          "Content-Type": tipo,
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const { data: seg } = await admin
      .from("messaging_channel_secrets")
      .select("page_access_token")
      .eq("channel_id", conv.channel_id)
      .maybeSingle();
    const token = seg?.page_access_token;
    if (!token) return json({ error: "A caixa já não tem credenciais." }, 409);

    // 1. O id dá um endereço temporário.
    const metaRes = await fetch(
      `${GRAPH}/${encodeURIComponent(String(media_id))}?access_token=${encodeURIComponent(token)}`,
    );
    const metaJson = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !metaJson?.url) {
      logError("a Meta não deu o endereço do ficheiro", {
        estado: metaRes.status, erro: metaJson?.error?.message,
      });
      return json({
        error: metaJson?.error?.message
          ?? "A Meta já não tem este ficheiro. Os ficheiros do WhatsApp são apagados ao fim de algum tempo.",
      }, 404);
    }

    // 2. E o endereço só abre com o token — não é um link público.
    const ficheiro = await fetch(String(metaJson.url), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!ficheiro.ok) {
      logError("descarga do ficheiro falhou", { estado: ficheiro.status });
      return json({ error: `Não foi possível descarregar o ficheiro (${ficheiro.status})` }, 502);
    }

    const tipo = String(metaJson.mime_type ?? anexo.mime ?? "application/octet-stream");
    log("ficheiro servido", { media_id, tipo, bytes: metaJson.file_size ?? null });

    return new Response(ficheiro.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": tipo,
        // O ficheiro em si não muda; o que expira é o endereço da Meta. Uma
        // hora de cache poupa uma ida ao Graph por cada vez que se rola a
        // conversa para cima.
        "Cache-Control": "private, max-age=3600",
        // Nada aqui é para ser interpretado como página.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    logError("erro inesperado", { error: (e as Error).message });
    return json({ error: (e as Error).message }, 500);
  }
});
