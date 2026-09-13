import { userRateLimit } from '../_shared/user-rate-limit.ts';
import { corsHeaders, json, getConfig, authOrgMember } from '../_shared/multicanal.ts';
import { parseAudioInput, readAudioBody } from '../_shared/audio-input.ts';
import { paidQuota } from '../_shared/paid-quota.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  try {
    const input = parseAudioInput(await req.json());
    if (!input.success) return json({ error: 'Identificação do anexo inválida' }, 400);
    const { organization_id, message_id, media_id } = input.data;
    const cfg = getConfig();
    const auth = await authOrgMember(req, cfg, organization_id);
    if ('error' in auth) return auth.error;
    const { data: message, error: messageError } = await auth.admin.from('meta_messages')
      .select('conversation_id').eq('id', message_id).maybeSingle();
    if (messageError || !message) return json({ error: 'Anexo indisponível' }, 404);
    const { data: conversation, error: conversationError } = await auth.admin.from('meta_conversations')
      .select('channel_id').eq('id', message.conversation_id)
      .eq('organization_id', organization_id).maybeSingle();
    if (conversationError || !conversation) return json({ error: 'Anexo indisponível' }, 404);
    const { data: channel, error: channelError } = await auth.admin.from('messaging_channels')
      .select('id').eq('id', conversation.channel_id).eq('organization_id', organization_id).maybeSingle();
    if (channelError || !channel) return json({ error: 'Anexo indisponível' }, 404);
    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) return json({ error: 'Transcrição indisponível' }, 503);
    const limitResponse = await userRateLimit(auth.admin, auth.userId, 'transcribe-audio', corsHeaders);
    if (limitResponse) return limitResponse;
    if (!await paidQuota(auth.admin, 'transcribe:org:' + organization_id, 100, 86400)) {
      return json({ error: 'Limite de transcrição atingido' }, 429);
    }
    const mediaResponse = await fetch(cfg.supabaseUrl + '/functions/v1/meta-media', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: req.headers.get('Authorization') ?? '', apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id, media_id }),
    });
    if (!mediaResponse.ok) {
      await mediaResponse.body?.cancel();
      return json({ error: 'Anexo indisponível' }, mediaResponse.status === 403 ? 403 : 502);
    }
    const mime = (mediaResponse.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('audio/') && mime !== 'video/mp4' && mime !== 'video/webm') {
      await mediaResponse.body?.cancel();
      return json({ error: 'Formato de áudio inválido' }, 415);
    }
    const audio = await readAudioBody(mediaResponse, 20 * 1024 * 1024);
    const extensions: Record<string, string> = {
      'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'audio/wav': 'wav',
      'audio/x-wav': 'wav', 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/flac': 'flac', 'audio/opus': 'opus',
    };
    const form = new FormData();
    form.append('file', audio, 'audio.' + (extensions[mime] ?? 'ogg'));
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'json');
    const result = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: 'Bearer ' + groqKey }, body: form,
    });
    if (!result.ok) {
      await result.body?.cancel();
      return json({ error: 'Não foi possível transcrever o áudio' }, 502);
    }
    const body: unknown = await result.json();
    if (typeof body !== 'object' || body === null || !('text' in body) || typeof body.text !== 'string') {
      return json({ error: 'Resposta de transcrição inválida' }, 502);
    }
    return json({ text: body.text.trim() });
  } catch (error) {
    if (error instanceof RangeError) return json({ error: 'Áudio vazio ou superior a 20 MiB' }, 413);
    if (error instanceof SyntaxError) return json({ error: 'Pedido inválido' }, 400);
    console.error('transcription_failed', { kind: error instanceof Error ? error.name : 'unknown' });
    return json({ error: 'Transcrição temporariamente indisponível' }, 502);
  }
});
