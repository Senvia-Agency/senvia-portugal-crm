// Shared emoji search index, including Google artwork coordinates for the Inbox picker.
// Legacy renderWithEmoji callers retain native glyphs; the current Inbox uses EmojiGlyph.
import data from "@emoji-mart/data/sets/15/google.json";
import { init, SearchIndex } from "emoji-mart";
import emojiRegex from "emoji-regex";
import React from "react";

// Register the emoji data + native set once. This powers both the <em-emoji>
// web component and the picker. Safe to import from anywhere — runs a single time.
init({ data, set: "google" });

// Portuguese aliases for the ":" shortcut. emoji-mart's own search index is
// keyworded in ENGLISH, so a pt-PT user typing ":sol" / ":lua" / ":coracao"
// finds nothing there. These map the common Portuguese words people actually
// type to the native emoji; anything not covered here falls through to the full
// emoji-mart search below, so no emoji is ever unreachable from the composer.
const PT_ALIASES: Record<string, string> = {
  // caras / emoções
  sorriso: "😀", sorrir: "😀", riso: "😂", rir: "😂", gargalhada: "🤣", chorar: "😢",
  choro: "😢", feliz: "😄", contente: "😊", apaixonado: "😍", amoroso: "🥰", piscar: "😉",
  piscadela: "😉", fixe: "😎", giro: "😎", pensar: "🤔", pensativo: "🤔", suor: "😅",
  triste: "😢", zangado: "😡", raiva: "😡", furioso: "🤬", surpresa: "😮", espanto: "😲",
  medo: "😱", assustado: "😱", cansado: "😴", sono: "😴", dormir: "😴", doente: "🤒",
  vomitar: "🤮", tonto: "😵", festa: "🥳", festejar: "🥳", careta: "😜", beijo: "😘",
  beijinho: "😘", envergonhado: "😳", nervoso: "😬", aliviado: "😌", anjo: "😇",
  diabo: "😈", palhaco: "🤡", caveira: "💀", coco: "💩", fantasma: "👻", alien: "👽",
  robo: "🤖", piada: "😹",
  // gestos / mãos
  joia: "👍", fixolas: "👍", like: "👍", gosto: "👍", polegar: "👍", naolike: "👎",
  naogosto: "👎", rezar: "🙏", obrigado: "🙏", obrigada: "🙏", porfavor: "🙏",
  palmas: "👏", aplausos: "👏", parabens: "🎉", forca: "💪", musculo: "💪",
  aperto: "🤝", maos: "🤝", combinado: "🤝", acordo: "🤝", ok: "👌", perfeito: "👌",
  fixe2: "👌", paz: "✌️", vitoria: "✌️", cruzar: "🤞", sorte: "🤞", rock: "🤘",
  aceno: "👋", ola: "👋", adeus: "👋", tchau: "👋", apontar: "👉", escrever: "✍️",
  // corações
  coracao: "❤️", amor: "❤️", vermelho: "❤️", laranja: "🧡", amarelo: "💛",
  verde: "💚", azul: "💙", roxo: "💜", preto: "🖤", branco: "🤍", castanho: "🤎",
  partido: "💔", brilho: "💖", coracaozinho: "💕",
  // natureza / tempo / céu
  sol: "☀️", solar: "☀️", ensolarado: "🌞", lua: "🌙", luar: "🌙", luacheia: "🌕",
  estrela: "⭐", estrelas: "✨", brilhar: "✨", nuvem: "☁️", nublado: "☁️",
  chuva: "🌧️", chover: "🌧️", chuvoso: "🌧️", trovoada: "⛈️", relampago: "⚡",
  raio: "⚡", neve: "❄️", floco: "❄️", boneco: "⛄", arcoiris: "🌈", vento: "🌬️",
  fogo: "🔥", chama: "🔥", agua: "💧", gota: "💧", gotas: "💦", mar: "🌊", onda: "🌊",
  oceano: "🌊", terra: "🌍", mundo: "🌍", planeta: "🪐", montanha: "⛰️", vulcao: "🌋",
  // plantas / animais
  arvore: "🌳", pinheiro: "🌲", palmeira: "🌴", cato: "🌵", flor: "🌸", rosa: "🌹",
  girassol: "🌻", tulipa: "🌷", folha: "🍃", trevo: "🍀", cogumelo: "🍄",
  cao: "🐶", cachorro: "🐶", gato: "🐱", rato: "🐭", coelho: "🐰", raposa: "🦊",
  urso: "🐻", panda: "🐼", leao: "🦁", tigre: "🐯", vaca: "🐮", porco: "🐷",
  macaco: "🐵", galinha: "🐔", passaro: "🐦", pinguim: "🐧", peixe: "🐟",
  golfinho: "🐬", baleia: "🐳", tubarao: "🦈", polvo: "🐙", caracol: "🐌",
  borboleta: "🦋", abelha: "🐝", joaninha: "🐞", aranha: "🕷️", cavalo: "🐴",
  unicornio: "🦄", dragao: "🐉", cobra: "🐍", tartaruga: "🐢", sapo: "🐸",
  // comida / bebida
  cafe: "☕", cha: "🍵", cerveja: "🍺", vinho: "🍷", agua2: "🥤", sumo: "🧃",
  bolo: "🎂", pizza: "🍕", hamburguer: "🍔", batatas: "🍟", pao: "🍞",
  queijo: "🧀", ovo: "🥚", fruta: "🍎", maca: "🍎", banana: "🍌", uvas: "🍇",
  morango: "🍓", laranjafruta: "🍊", limao: "🍋", melancia: "🍉", gelado: "🍦",
  chocolate: "🍫", doce: "🍬", pipocas: "🍿",
  // objetos / símbolos
  festao: "🎉", balao: "🎈", presente: "🎁", prenda: "🎁", trofeu: "🏆",
  medalha: "🏅", ideia: "💡", lampada: "💡", pino: "📌", fixar: "📌", chave: "🔑",
  cadeado: "🔒", escudo: "🛡️", musica: "🎵", nota: "🎶", auscultadores: "🎧",
  documento: "📄", papel: "📄", lapis: "✏️", caneta: "🖊️", livro: "📚",
  computador: "💻", telemovel: "📱", telefone: "📞", ligar: "📞", email: "📧",
  carta: "✉️", dinheiro: "💰", euro: "💶", cartao: "💳", grafico: "📈",
  calendario: "📅", data: "📅", relogio: "⏰", ampulheta: "⏳", foguete: "🚀",
  lancamento: "🚀", alvo: "🎯", carro: "🚗", aviao: "✈️", barco: "⛵", casa: "🏠",
  loja: "🏪", trabalho: "🏢", escritorio: "🏢", ferramentas: "🛠️", cadeira: "🪑",
  camera: "📷", foto: "📷", video: "🎬", jogo: "🎮", bola: "⚽", futebol: "⚽",
  // sinais / marcas
  sim: "✅", certo: "✅", check: "✅", visto: "✅", nao: "❌", errado: "❌",
  cruz: "❌", aviso: "⚠️", alerta: "⚠️", proibido: "🚫", info: "ℹ️",
  pergunta: "❓", exclamacao: "❗", cem: "💯", estrelinha: "🌟",
};

// Full-coverage emoji search for the ":" shortcut: Portuguese aliases first
// (exact words a pt-PT user types), then the complete emoji-mart index (English
// keywords + shortcodes) so EVERY emoji is reachable. Deduped, capped. Async
// because emoji-mart's SearchIndex resolves a promise; callers must guard
// against stale queries (the user keeps typing while this resolves).
export async function searchEmojis(query: string, limit = 8): Promise<string[]> {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (n: string | undefined | null) => {
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  };
  // 1) Portuguese aliases — prefix matches rank first, then substring.
  for (const [name, native] of Object.entries(PT_ALIASES)) {
    if (name.startsWith(q)) push(native);
  }
  for (const [name, native] of Object.entries(PT_ALIASES)) {
    if (!name.startsWith(q) && name.includes(q)) push(native);
  }
  // 2) emoji-mart full index (covers everything the aliases don't).
  try {
    const results = await SearchIndex.search(q);
    for (const e of (results ?? []) as Array<{ skins?: Array<{ native?: string }> }>) {
      push(e?.skins?.[0]?.native);
    }
  } catch {
    /* index not ready / bad query — the aliases above still work */
  }
  return out.slice(0, limit);
}

// Battle-tested matcher for full emoji grapheme clusters (ZWJ sequences like
// 👨‍👩‍👧, flags, skin-tone modifiers, variation selectors).
const RE = emojiRegex();

// True if the text contains at least one emoji — lets callers skip the split work
// for the common all-text message.
export function hasEmoji(text: string): boolean {
  RE.lastIndex = 0;
  return RE.test(text);
}

// Split a plain string into React nodes, replacing each emoji with an Apple-style
// image (<em-emoji>). Text runs are returned as-is. `size` is a CSS length so the
// emoji scales with the surrounding font.
export function renderWithEmoji(
  text: string,
  opts: { keyPrefix?: string; size?: string } = {},
): React.ReactNode[] {
  const { keyPrefix = "", size = "1.25em" } = opts;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <em-emoji
        key={`${keyPrefix}e${m.index}`}
        native={m[0]}
        set="native"
        size={size}
        fallback={m[0]}
        // Keep the glyph on the text baseline so it doesn't push line-height around.
        style={{ display: "inline-block", verticalAlign: "-0.15em" }}
      />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
