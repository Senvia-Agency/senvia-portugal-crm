import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const schema = {
  type: 'object', additionalProperties: false,
  required: ['tarefa', 'titulo', 'confianca', 'prazo_texto', 'prazo_explicito'],
  properties: { tarefa: { type: 'boolean' }, titulo: { type: 'string', maxLength: 100 }, confianca: { type: 'number', minimum: 0, maximum: 1 }, prazo_texto: { type: ['string', 'null'] }, prazo_explicito: { type: 'boolean' } },
};
const empty = { tarefa: false, titulo: '', confianca: 0, prazo_texto: null, prazo_explicito: false };
const digest = value => createHash('sha256').update(value).digest();
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const manipulated = message => /(?:ignor[ae]|esque[çc]a|desconsider[ae]).{0,60}(?:regras|instrucoes|prompt)|(?:ignore|disregard).{0,60}(?:rules|instructions|prompt)|system\s*prompt|<\|(?:im_start|system)/i.test(normalize(message));

function parseDecision(value, message) {
  if (!value || typeof value !== 'object' || typeof value.tarefa !== 'boolean' || typeof value.titulo !== 'string' || typeof value.confianca !== 'number' || value.confianca < 0 || value.confianca > 1 || typeof value.prazo_explicito !== 'boolean' || !(value.prazo_texto === null || typeof value.prazo_texto === 'string')) throw new Error('INVALID_MODEL_RESPONSE');
  if (!value.tarefa || value.confianca < .85 || !value.titulo.trim()) return empty;
  const explicit = value.prazo_explicito && typeof value.prazo_texto === 'string' && normalize(message).includes(normalize(value.prazo_texto)) && value.prazo_texto.trim().length > 0;
  return { tarefa: true, titulo: value.titulo.trim().slice(0, 100), confianca: value.confianca, prazo_texto: explicit ? value.prazo_texto : null, prazo_explicito: Boolean(explicit) };
}

export async function localClassify(input) {
  const payload = JSON.stringify({ model: 'senvia-tarefas:3b', stream: false, format: schema, keep_alive: '10m', messages: [{ role: 'user', content: JSON.stringify(input) }] });
  const response = await new Promise((resolve, reject) => {
    const request = http.request('http://127.0.0.1:11434/api/chat', { method: 'POST', signal: AbortSignal.timeout(65_000), headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, upstream => {
      let size = 0; const chunks = [];
      upstream.on('data', chunk => { size += chunk.length; if (size > 65536) upstream.destroy(new Error('MODEL_RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
      upstream.on('error', reject);
      upstream.on('end', () => {
        if (upstream.statusCode !== 200) { reject(new Error('MODEL_UNAVAILABLE')); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('INVALID_MODEL_RESPONSE')); }
      });
    });
    request.on('error', reject); request.end(payload);
  });
  return parseDecision(JSON.parse(response.message.content), input.message);
}

export function createGateway({ token, classify = localClassify }) {
  if (!token) throw new Error('GATEWAY_NOT_CONFIGURED');
  let active = false; const waiting = [];
  const acquire = () => new Promise((resolve, reject) => {
    if (!active) { active = true; resolve(); return; }
    if (waiting.length >= 2) { reject(new Error('BUSY')); return; }
    const waiter = { resolve, timer: setTimeout(() => { const index = waiting.indexOf(waiter); if (index >= 0) waiting.splice(index, 1); reject(new Error('BUSY')); }, 30000) };
    waiting.push(waiter);
  });
  const release = () => { const next = waiting.shift(); if (next) { clearTimeout(next.timer); next.resolve(); } else active = false; };
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    const bearer = req.headers.authorization?.match(/^Bearer (.{1,256})$/)?.[1];
    if (!bearer || !timingSafeEqual(digest(bearer), digest(token))) { send(res, 401, { error: 'UNAUTHORIZED' }); req.resume(); return; }
    if (req.url === '/senvia-tasks/v1/health' && req.method === 'GET') { send(res, 200, { ok: true, model: 'senvia-tarefas:3b' }); return; }
    if (req.url !== '/senvia-tasks/v1/classify' || req.method !== 'POST') { send(res, 404, { error: 'NOT_FOUND' }); req.resume(); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { send(res, 415, { error: 'INVALID_CONTENT_TYPE' }); req.resume(); return; }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) { size += chunk.length; if (size > 8192) { send(res, 413, { error: 'INPUT_TOO_LARGE' }); return; } chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(res, 400, { error: 'INVALID_INPUT' }); return; }
      if (!input || Object.keys(input).some(key => !['sender', 'message'].includes(key)) || !['CLIENTE', 'COMERCIAL'].includes(input.sender) || typeof input.message !== 'string' || input.message.trim().length < 15 || input.message.length > 1200) { send(res, 400, { error: 'INVALID_INPUT' }); return; }
      if (manipulated(input.message)) { send(res, 200, empty); return; }
      await acquire();
      try { send(res, 200, parseDecision(await classify(input), input.message)); } finally { release(); }
    } catch (error) { send(res, error instanceof Error && error.message === 'BUSY' ? 429 : 502, { error: error instanceof Error && error.message === 'BUSY' ? 'BUSY' : 'MODEL_UNAVAILABLE' }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGateway({ token: process.env.SENVIA_AI_GATEWAY_KEY });
  server.listen(11435, '127.0.0.1', () => console.log('Senvia task gateway listening on loopback'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
