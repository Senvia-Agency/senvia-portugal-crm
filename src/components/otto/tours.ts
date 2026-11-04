import type { OttoExpression } from "./OttoAvatar";
import type { OttoManagedModal } from "@/stores/useModalStore";

// One step of a guided tour. `targetId` matches a data-otto-target attribute on a
// real element. Steps are authored here (deterministic), never by the LLM.
export interface SpotlightStep {
  targetId?: string;                       // data-otto-target; omit for a centered card
  title: string;
  description: string;
  avatarExpression: OttoExpression;
  arrowPosition?: "top" | "bottom" | "left" | "right";
  action?: "highlight" | "pulse" | "glow";
  navigateTo?: string;                     // route to push before the step shows
  openModal?: Exclude<OttoManagedModal, null>; // open a managed modal before the step
  advanceOnClick?: boolean;                // advance when the user clicks the target
  skipIfMissing?: boolean;                 // left out when its target is not on screen (admin-only, module off…)
  placement?: "right";                     // card beside the target instead of below it (tall targets)
  requires?: string;                       // data-otto-target that must be on screen when the tour starts (else the step is left out)
  optional?: boolean;                      // target missing at run time (another page, admin-only button) → step skipped
  openTarget?: boolean;                    // open the target (its menu, panel or dialog) and show it, instead of dimming the page
}

export interface TourDef {
  id: string;
  title: string;
  steps: SpotlightStep[];
}

// The catalogue Otto can launch via a [tour:<id>] token. Keep ids stable — they
// are part of the contract with the model prompt.
//
// Note: WhatsApp is NOT a tour — it opens the real connection modal (with the QR
// + built-in instructions) via the [modal:whatsapp] token. Faturação/Brevo/dados
// da empresa are handled autonomously by Otto's write tools (paste the value in
// chat, Otto saves it), so they are not tours either. Tours are reserved for
// "show me where to click" flows whose target lives on a reachable page.
export const TOURS: Record<string, TourDef> = {
  setup_pipeline: {
    id: "setup_pipeline",
    title: "Configurar o pipeline",
    steps: [
      {
        targetId: "settings-pipeline-add",
        navigateTo: "/settings?og=sales&os=sales-pipeline",
        title: "Cria as tuas etapas",
        description: "Carrega em Adicionar para construíres o teu funil de vendas, etapa a etapa.",
        avatarExpression: "pointing",
        arrowPosition: "top",
        action: "pulse",
        advanceOnClick: true,
      },
    ],
  },
  invite_member: {
    id: "invite_member",
    title: "Convidar a equipa",
    steps: [
      {
        targetId: "settings-invite-member",
        navigateTo: "/settings?og=team&os=team-access",
        title: "Adiciona um colega",
        description: "Carrega em Adicionar Acesso para convidares um membro e definires as permissões dele.",
        avatarExpression: "pointing",
        arrowPosition: "top",
        action: "pulse",
        advanceOnClick: true,
      },
    ],
  },
  import_leads: {
    id: "import_leads",
    title: "Importar leads",
    steps: [
      {
        targetId: "leads-import-btn",
        navigateTo: "/leads",
        title: "Importa as tuas leads",
        description: "Abre este menu e escolhe Importar leads para carregares um ficheiro CSV ou Excel com os teus contactos.",
        avatarExpression: "pointing",
        arrowPosition: "bottom",
        action: "pulse",
        advanceOnClick: true,
      },
    ],
  },
  // Senvia 2.0 tour: where everything is in the new interface. Launched by the
  // welcome card (Senvia2Guide) and from the account menu. It opens each new
  // module and points at what matters there, then opens each top-bar menu, and
  // ends on the switch back to the old version. A module this person does not
  // have is left out (`requires`); a button they do not have is skipped (`optional`).
  senvia_2: {
    id: "senvia_2",
    title: "Guia do Senvia 2.0",
    steps: [
      { targetId: "guide-sidebar", placement: "right", skipIfMissing: true, avatarExpression: "pointing", action: "glow",
        title: "Os módulos, por áreas",
        description: "O menu lateral junta tudo por áreas: Comunicação, Trabalho, Comercial e Gestão. Vamos abrir as novidades uma a uma." },

      { navigateTo: "/inbox", targetId: "guide-inbox-team", requires: "guide-inbox", optional: true, avatarExpression: "happy", action: "pulse",
        title: "Caixa de entrada: Mensagens internas",
        description: "Na Caixa de entrada estão as conversas de WhatsApp, Instagram e Messenger. Novo: as Mensagens internas, para falar com a equipa sem sair do Senvia OS." },

      { navigateTo: "/feed", targetId: "guide-feed-composer", requires: "guide-feed", avatarExpression: "happy", action: "pulse",
        title: "Feed: as novidades da empresa",
        description: "Escreva aqui para toda a equipa ver. Pode juntar fotografias e documentos, e os colegas reagem e comentam." },
      { navigateTo: "/feed", targetId: "guide-feed-announce", requires: "guide-feed", optional: true, avatarExpression: "pointing", action: "glow",
        title: "Comunicados",
        description: "Os administradores escolhem Comunicado antes de Publicar: a mensagem aparece em destaque para toda a empresa e pode ser fixada no topo do Feed." },
      { navigateTo: "/feed", targetId: "guide-feed-recognize", requires: "guide-feed", optional: true, avatarExpression: "happy", action: "pulse",
        title: "Reconhecer um colega",
        description: "Agradeça um bom trabalho à frente de toda a equipa. Os reconhecimentos ficam no Feed." },

      { navigateTo: "/tasks", targetId: "guide-tasks-new", requires: "guide-tasks", avatarExpression: "happy", action: "pulse",
        title: "Tarefas",
        description: "Crie uma tarefa e atribua-a a si ou a colegas. Cada um vê o que tem para fazer." },
      { navigateTo: "/tasks", targetId: "guide-tasks-views", requires: "guide-tasks", optional: true, avatarExpression: "pointing", action: "pulse",
        title: "Lista ou quadro",
        description: "Veja as tarefas em lista ou num quadro por estado." },

      { navigateTo: "/webmail", targetId: "guide-email-compose", requires: "guide-email", optional: true, avatarExpression: "happy", action: "pulse",
        title: "Email",
        description: "As caixas de email da empresa dentro do Senvia OS. Carregue em Escrever para enviar a partir de qualquer caixa." },
      { navigateTo: "/webmail", targetId: "guide-email-folders", requires: "guide-email", optional: true, avatarExpression: "pointing", action: "pulse",
        title: "Caixas e pastas",
        description: "Cada caixa tem as suas pastas. Crie pastas novas, mova emails para lá ou deixe as regras automáticas fazê-lo." },

      { navigateTo: "/automacoes", targetId: "guide-automations-new", requires: "guide-automations", avatarExpression: "happy", action: "pulse",
        title: "Automações",
        description: "Monte um fluxo num editor visual: escolha o que o inicia e junte os passos seguintes, como enviar um email ou um WhatsApp." },
      { navigateTo: "/automacoes", targetId: "guide-automations-templates", requires: "guide-automations", optional: true, avatarExpression: "pointing", action: "pulse",
        title: "Começar por um modelo",
        description: "Ou parta de um modelo pronto e ajuste-o à sua empresa." },

      { targetId: "guide-search", skipIfMissing: true, openTarget: true, avatarExpression: "pointing", action: "pulse",
        title: "Encontre qualquer página",
        description: "Escreva o nome de um módulo ou página e carregue em Enter. Abre a qualquer momento com Ctrl K." },
      { targetId: "guide-otto", skipIfMissing: true, openTarget: true, avatarExpression: "happy", action: "pulse",
        title: "O Otto ajuda",
        description: "Pergunte como fazer qualquer coisa ou abra um ticket de suporte. Continua a responder com o painel fechado e avisa quando a resposta chega. Atalho: Ctrl J." },
      { targetId: "guide-notifications", skipIfMissing: true, openTarget: true, avatarExpression: "pointing", action: "pulse",
        title: "Notificações",
        description: "Vendas fechadas e mensagens por ler na Caixa de entrada e no Email aparecem aqui." },
      { targetId: "guide-ponto", skipIfMissing: true, openTarget: true, avatarExpression: "pointing", action: "pulse",
        title: "Ponto",
        description: "Veja o seu dia e registe a entrada e a saída a partir daqui." },
      { targetId: "guide-account", skipIfMissing: true, openTarget: true, avatarExpression: "pointing", action: "pulse",
        title: "A sua conta",
        description: "Perfil, foto, horário de trabalho, idioma e mudança de empresa ficam neste menu. O guia também se repete daqui." },
      { navigateTo: "/indicacoes", targetId: "guide-referrals-offers", requires: "guide-referrals-nav", avatarExpression: "happy", action: "glow",
        title: "Indicações",
        description: "Duas formas de pagar menos: indique uma empresa e ganhe 1 mês grátis quando ela pagar, ou grave uma avaliação em vídeo e ganhe desconto. Os administradores encontram esta página no menu e no botão \"Ganhe meses grátis\"." },
      { targetId: "guide-news", skipIfMissing: true, avatarExpression: "happy", action: "pulse",
        title: "Novidades",
        description: "Tudo o que muda no Senvia OS fica aqui, versão a versão. Quando houver uma novidade por ler, aparece a marca Novo." },
      { targetId: "guide-version", skipIfMissing: true, avatarExpression: "pointing", action: "glow",
        title: "Prefere a versão antiga?",
        description: "Ligue este botão para voltar à interface antiga. Os seus dados são os mesmos, e pode voltar ao novo Senvia OS quando quiser." },
    ],
  },
  // The same tour on a phone: the sidebar becomes the menu and the bottom bar, so
  // those are told on cards; the top-bar menus a phone has are opened.
  senvia_2_mobile: {
    id: "senvia_2_mobile",
    title: "Guia do Senvia 2.0",
    steps: [
      { avatarExpression: "happy", title: "Bem-vindo ao novo Senvia OS",
        description: "No telemóvel, os módulos estão no menu do topo e os mais usados na barra de baixo." },
      { avatarExpression: "happy", title: "O que há de novo",
        description: "Mensagens internas na Caixa de entrada, Feed da empresa, Tarefas, Email, Automações em fluxo e Ponto. Encontra-os no menu." },
      { avatarExpression: "happy", title: "O Otto ajuda",
        description: "Abra o Otto em Suporte / Otto para tirar dúvidas ou abrir um ticket. Avisa quando a resposta chega." },
      { targetId: "guide-notifications", skipIfMissing: true, openTarget: true, avatarExpression: "pointing", action: "pulse",
        title: "Notificações",
        description: "Vendas fechadas e mensagens por ler na Caixa de entrada e no Email aparecem aqui." },
      { targetId: "guide-ponto", skipIfMissing: true, openTarget: true, avatarExpression: "pointing", action: "pulse",
        title: "Ponto",
        description: "Veja o seu dia e registe a entrada e a saída a partir daqui." },
      { targetId: "guide-account", skipIfMissing: true, openTarget: true, avatarExpression: "pointing", action: "pulse",
        title: "A sua conta",
        description: "Perfil, foto, horário de trabalho, idioma e mudança de empresa ficam neste menu. O guia também se repete daqui." },
      { targetId: "guide-version", skipIfMissing: true, avatarExpression: "pointing", action: "glow",
        title: "Prefere a versão antiga?",
        description: "Ligue este botão para voltar à interface antiga. Os seus dados são os mesmos, e pode voltar ao novo Senvia OS quando quiser." },
    ],
  },
};

export function getTour(id: string): TourDef | null {
  return TOURS[id] ?? null;
}
