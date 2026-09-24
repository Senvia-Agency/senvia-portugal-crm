// Versão actual do Senvia OS
export const APP_VERSION = '26.5.10';

// URL canónica usada APENAS como fallback (links externos/edge functions
// quando não há `window`). Em runtime, preferimos sempre o host actual
// para evitar que preview/staging gerem links para outro deploy.
export const PRODUCTION_URL = 'https://app.senvia.pt';

// Detecta o ambiente e retorna a URL base correcta.
// Regra: usar o host actual quando existir `window` — mas SÓ se for http(s).
// Dentro da extensão do Chrome a origem é `chrome-extension://<id>`, que não
// abre em máquina nenhuma e ainda muda a cada recarregamento em modo unpacked.
// Como esta função alimenta links de convite copiados e o URL de acesso ENVIADO
// POR EMAIL (TeamTab), deixar passar essa origem produzia links mortos para
// terceiros. Em SSR/edge continua a cair no PRODUCTION_URL.
export const getBaseUrl = () => {
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    return window.location.origin;
  }
  return PRODUCTION_URL;
};

// Helper para gerar URLs relativas ao host actual (ou produção em SSR).
export const getProductionUrl = (path: string) => {
  const base = getBaseUrl();
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
};

// Tunable magic numbers for the inbox (Caixa de Entrada). Centralized so the SLA
// thresholds, grouping window, attachment cap and desktop breakpoint aren't
// scattered as literals across the page and its sub-components.
export const INBOX_CONFIG = {
  // Customer-waiting SLA traffic light.
  SLA_WARN_MIN: 15,
  SLA_LATE_MIN: 60,
  // Consecutive same-sender messages within this window render as one group.
  GROUP_WINDOW_MS: 5 * 60 * 1000,
  // Max outgoing attachment size.
  ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  // px width at/above which the contact panel is a fixed column (else a Sheet).
  DESKTOP_BREAKPOINT: 1024,
} as const;

/**
 * Que canais de mensagens estão abertos, um a um.
 *
 * Era um interruptor único para todos. Deixou de servir: o Instagram e o
 * Messenger passaram a funcionar pela API oficial da Meta (Facebook Login for
 * Business → edge function `meta-connect`), enquanto o WhatsApp continua
 * fechado — a ligação não-oficial que existia violava os Termos da Meta e
 * arriscava o ban do número do cliente, e a via oficial ainda não está montada.
 *
 * O que estiver `false` aparece como "Brevemente" e não se liga.
 *
 * Os canais já ligados de um tipo fechado NÃO são apagados — apenas deixam de
 * ser listados. Reabrir é mudar aqui, e reaparecem.
 */
// Isto governa a INTERFACE. Cada canal notifica pelo seu próprio caminho no
// servidor (meta-webhook para os três, gatilho na base de dados para o email),
// por isso desligar um aqui já não deixa nada a apitar no telemóvel — o
// chatwoot-webhook, que era a exceção, deixou de existir.
export const MESSAGING_CHANNELS = {
  // Cloud API oficial da Meta. As caixas antigas do Evolution NÃO voltam com
  // isto: são excluídas pelo `provider` em useMessagingChannels.
  // Pausados a pedido (2026-09-01): só o email fica ativo por agora. As
  // caixas já ligadas continuam na base de dados — voltar a "true" reabre-as.
  whatsapp: false,
  instagram: false,
  facebook: false,
} as const;

/** True se ALGUM canal de mensagens está aberto (o email é sempre à parte). */
export const MESSAGING_CHANNELS_ENABLED =
  MESSAGING_CHANNELS.whatsapp || MESSAGING_CHANNELS.instagram || MESSAGING_CHANNELS.facebook;

/** Um canal concreto está aberto? Tipos desconhecidos ficam fechados. */
export function isChannelEnabled(channelType: string | null | undefined): boolean {
  if (channelType === 'email') return true;
  return MESSAGING_CHANNELS[channelType as keyof typeof MESSAGING_CHANNELS] ?? false;
}

/** Rótulo mostrado nos canais ainda por abrir. */
export const CHANNEL_COMING_SOON_LABEL = 'Brevemente';
