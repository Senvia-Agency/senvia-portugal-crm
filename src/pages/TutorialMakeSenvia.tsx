import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronRight, Clipboard, ExternalLink, FileText, Loader2, PlayCircle, Printer, Send, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { SEO } from "@/components/SEO";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadIntakeWebhooks } from "@/hooks/useLeadIntakeWebhooks";
import { Button } from "@/components/ui/button";

const asset = (name: string) => `/tutorials/make-senvia/${name}`;

// O endpoint do SENVIA OS e sempre o mesmo; so o token muda de organizacao para
// organizacao (cada org tem o seu em Definicoes > Integracoes > Webhooks de Entrada).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://chhmfwlimtbsyjmgtokn.supabase.co";
const WEBHOOK_URL_EXAMPLE = `${SUPABASE_URL}/functions/v1/submit-lead?mode=webhook&token=O-SEU-TOKEN`;
const SETTINGS_WEBHOOKS_LINK = "/settings?og=integrations&os=integrations-connect";

const facebookSteps = [
  {
    src: asset("facebook-new-lead.jpg"),
    title: "Escolher Facebook Lead Ads",
    description: "No primeiro modulo, pesquise por Facebook Lead Ads e selecione New Lead.",
  },
  {
    src: asset("facebook-add-module.jpg"),
    title: "Modulo New Lead",
    description: "Este sera o primeiro passo do scenario, responsavel por receber novos leads.",
  },
  {
    src: asset("facebook-config-webhook.jpg"),
    title: "Criar ou selecionar webhook",
    description: "No campo Webhook, clique em Add ou escolha uma ligacao ja existente.",
  },
  {
    src: asset("facebook-fields-select.jpg"),
    title: "Selecionar os campos",
    description: "Em Fields, selecione todos os campos disponiveis para enviar os dados completos.",
  },
  {
    src: asset("facebook-id-finder.jpg"),
    title: "Procurar a pagina",
    description: "Use o ID Finder para encontrar a pagina de Facebook pelo nome.",
  },
  {
    src: asset("facebook-form-select.jpg"),
    title: "Escolher o formulario",
    description: "Selecione o formulario de leads usado na campanha.",
  },
];

const checklist = [
  "Conta Make criada e com acesso ao Facebook correto.",
  "Scenario criado com o modulo Facebook Lead Ads > New Lead.",
  "Pagina de Facebook selecionada.",
  "Formulario certo selecionado.",
  "Todos os campos do formulario selecionados em Fields.",
  "URL do webhook da sua organizacao copiado em Definicoes > Integracoes.",
  "Modulo HTTP configurado com Make a request.",
  "Method mudado de GET (que vem por omissao) para POST.",
  "Corpo (body) preenchido a clicar nos campos do Facebook, nunca chavetas escritas a mao.",
  "Lead de teste recebido no SENVIA OS.",
  "Scenario guardado e ativado.",
];

// SEM chavetas de propósito. Isto vai para dentro do editor do Make como
// texto — se tivesse {{ }}, quem copia cola tal e qual e o Make tenta
// interpretar aquilo como uma fórmula dele, não como marcador. O passo
// seguinte explica: seleciona cada NOME_EM_MAIUSCULAS e clica no campo
// correspondente na lista da direita do Make, que substitui sozinho.
const payload = `{
  "name": "NOME_AQUI",
  "email": "EMAIL_AQUI",
  "phone": "TELEFONE_AQUI",
  "company": "EMPRESA_AQUI",
  "source": "Facebook Lead Ads",
  "notes": "Lead recebido automaticamente pelo Make"
}`;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="secondary" onClick={copy} className="gap-2">
      <Clipboard className="h-4 w-4" />
      {copied ? "Copiado" : "Copiar"}
    </Button>
  );
}

// Percurso exato dentro do SENVIA OS ate ao URL do webhook.
const CRM_PATH = ["Definicoes", "Integracoes", "Automacoes", "Webhook de Entrada", "Adicionar Webhook"];

function CrmPath() {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-lg border border-blue-600/20 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
      {CRM_PATH.map((label, index) => (
        <li key={label} className="flex items-center gap-1.5">
          {index > 0 && <ChevronRight className="h-4 w-4 text-blue-500/60" aria-hidden />}
          <span className="rounded-md bg-white px-2 py-1 shadow-sm">{label}</span>
        </li>
      ))}
    </ol>
  );
}

// Mostra o webhook real da organizacao de quem esta a ver a pagina. Como o
// tutorial e publico, quem chega sem sessao iniciada ve apenas o formato
// generico e o caminho para o ir buscar dentro do CRM.
function WebhookUrlBlock() {
  const { organization, isLoading: authLoading } = useAuth();
  const { data: webhooks = [], isLoading: webhooksLoading } = useLeadIntakeWebhooks();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const active = webhooks.filter((webhook) => webhook.is_active);
  const options = active.length > 0 ? active : webhooks;
  const selected = options.find((webhook) => webhook.id === selectedId) || options[0] || null;
  const loading = authLoading || (!!organization && webhooksLoading);
  const url = selected
    ? `${SUPABASE_URL}/functions/v1/submit-lead?mode=webhook&token=${selected.token}`
    : WEBHOOK_URL_EXAMPLE;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-4 py-3">
        <strong className="text-sm">{selected ? "O webhook da sua organizacao" : "Formato do URL"}</strong>
        {loading ? (
          <span className="flex items-center gap-2 text-xs text-slate-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            A carregar
          </span>
        ) : (
          <CopyButton value={url} />
        )}
      </div>
      <pre className="overflow-x-auto p-4 text-sm text-slate-100">
        <code>{url}</code>
      </pre>
      {selected ? (
        <div className="space-y-2 border-t border-white/10 bg-slate-900 px-4 py-3 text-xs text-slate-300">
          <p>
            URL pronto a colar no Make, ja com o token de{" "}
            <strong className="text-white">{organization?.name}</strong>. Nao precisa de escrever nada a mao.
          </p>
          {options.length > 1 && (
            <label className="flex flex-wrap items-center gap-2">
              <span>Webhook:</span>
              <Select value={selected.id} onValueChange={setSelectedId}><SelectTrigger aria-label="Webhook" className="h-8 w-auto border-white/20 bg-slate-950 text-xs text-white"><SelectValue /></SelectTrigger><SelectContent>{options.map(webhook => <SelectItem key={webhook.id} value={webhook.id}>{webhook.name}</SelectItem>)}</SelectContent></Select>
            </label>
          )}
        </div>
      ) : (
        <div className="space-y-2 border-t border-white/10 bg-slate-900 px-4 py-3 text-xs text-slate-300">
          <p>
            Esta a ver o formato generico porque nao tem sessao iniciada neste navegador. Entre no SENVIA OS e volte a
            abrir esta pagina: o token da sua organizacao aparece aqui automaticamente.
          </p>
          <Button asChild size="sm" variant="secondary" className="gap-2">
            <Link to="/">
              <ExternalLink className="h-4 w-4" />
              Entrar no SENVIA OS
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function StepCard({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <article className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[72px_1fr] md:p-7">
      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-blue-600/20 bg-blue-50 text-lg font-black text-blue-700">
        {number}
      </div>
      <div className="min-w-0">
        <h3 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h3>
        <div className="mt-3 space-y-4 text-slate-600">{children}</div>
      </div>
    </article>
  );
}

function ScreenshotCard({ src, title, description }: { src: string; title: string; description: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <img src={src} alt={title} className="aspect-video w-full object-contain" loading="lazy" />
      <figcaption className="border-t border-slate-200 bg-white p-3">
        <strong className="block text-sm text-slate-950">{title}</strong>
        <span className="mt-1 block text-sm text-slate-600">{description}</span>
      </figcaption>
    </figure>
  );
}

export default function TutorialMakeSenvia() {
  return (
    <>
      <SEO
        title="Tutorial Make + SENVIA OS"
        description="Guia para conectar Facebook Lead Ads ao SENVIA OS usando Make."
        canonical="/tutoriais/make"
      />

      <main className="min-h-screen bg-slate-50 text-slate-950">
        <header className="border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">SENVIA OS</p>
              <h1 className="text-xl font-black tracking-tight">Tutorial Make + Facebook Lead Ads</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="ghost" className="gap-2">
                <Link to="/tutoriais">
                  <ArrowLeft className="h-4 w-4" />
                  Todos os tutoriais
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <a href="#passos">
                  <PlayCircle className="h-4 w-4" />
                  Ver passos
                </a>
              </Button>
              <Button type="button" className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Imprimir PDF
              </Button>
            </div>
          </div>
        </header>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:px-8 lg:py-16">
          <div className="flex flex-col justify-center">
            <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-blue-600/20 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
              <ShieldCheck className="h-4 w-4" />
              Guia para configurar sozinho
            </p>
            <h2 className="max-w-4xl text-4xl font-black leading-[0.98] tracking-tight text-slate-950 sm:text-6xl">
              Como enviar leads do Facebook para o SENVIA OS automaticamente.
            </h2>
            <p className="mt-6 max-w-2xl text-lg text-slate-600">
              Sempre que uma pessoa preencher o formulario de lead no Facebook, o Make recebe esses dados e envia
              automaticamente para o SENVIA OS. Assim o lead entra no CRM sem copiar, colar ou importar ficheiros.
            </p>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-bold">Fluxo da integracao</h3>
            <div className="mt-5 space-y-3">
              {[
                ["1", "Lead entra no Facebook", "O contacto preenche o formulario do anuncio."],
                ["2", "Make recebe os dados", "O scenario recolhe nome, email, telefone e campos extra."],
                ["3", "HTTP envia para o CRM", "O modulo Make a request envia um POST para o webhook."],
                ["4", "SENVIA OS cria o lead", "O lead aparece no pipeline definido pela equipa."],
              ].map(([number, title, description]) => (
                <div key={number} className="grid grid-cols-[40px_1fr] gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white">{number}</span>
                  <span>
                    <strong className="block text-sm text-slate-950">{title}</strong>
                    <span className="block text-sm text-slate-600">{description}</span>
                  </span>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-blue-600/20 bg-blue-50 p-5">
              <CheckCircle2 className="mb-3 h-6 w-6 text-blue-600" />
              <h3 className="font-bold text-slate-950">O que vai ser configurado</h3>
              <p className="mt-2 text-sm text-slate-600">Facebook Lead Ads, Make e webhook de entrada do SENVIA OS.</p>
            </div>
            <div className="rounded-lg border border-amber-700/20 bg-amber-50 p-5">
              <FileText className="mb-3 h-6 w-6 text-amber-700" />
              <h3 className="font-bold text-slate-950">Antes de testar</h3>
              <p className="mt-2 text-sm text-slate-600">O formulario precisa existir e a conta Facebook deve ter acesso aos leads da pagina.</p>
            </div>
            <div className="rounded-lg border border-red-700/20 bg-red-50 p-5">
              <Send className="mb-3 h-6 w-6 text-red-700" />
              <h3 className="font-bold text-slate-950">Modulo correto no HTTP</h3>
              <p className="mt-2 text-sm text-slate-600">Use HTTP &gt; Make a request. Esse modulo envia os dados para o SENVIA OS.</p>
            </div>
          </div>
        </section>

        <section id="passos" className="mx-auto max-w-7xl space-y-5 px-4 py-10 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-wider text-blue-600">Passo a passo</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Configurar o scenario no Make</h2>
            <p className="mt-4 text-slate-600">Siga os passos na ordem. No fim, execute um teste antes de deixar a automacao ativa.</p>
          </div>

          <StepCard number="01" title="Criar conta no Make">
            <p>
              Acesse{" "}
              <a href="https://us2.make.com/" target="_blank" rel="noreferrer" className="font-semibold text-blue-600 underline underline-offset-4">
                us2.make.com <ExternalLink className="inline h-3 w-3" />
              </a>
              , crie uma conta gratuita ou entre numa conta existente.
            </p>
            <p>Para teste, o plano gratuito costuma ser suficiente. Para uso continuo, recomenda-se um plano pago adequado ao volume de leads.</p>
          </StepCard>

          <StepCard number="02" title="Criar um scenario">
            <p>No menu lateral do Make, entre em Scenarios e clique em Create a new scenario.</p>
            <p>Depois clique no botao grande de adicionar modulo e escolha Facebook Lead Ads &gt; New Lead.</p>
            <div className="grid gap-4 md:grid-cols-2">
              {facebookSteps.slice(0, 2).map((item) => (
                <ScreenshotCard key={item.src} {...item} />
              ))}
            </div>
          </StepCard>

          <StepCard number="03" title="Configurar o Facebook Lead Ads">
            <p>Autorize a conta Facebook que tem acesso a pagina e aos formularios de leads.</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>No campo Webhook, clique em Add ou selecione um webhook existente.</li>
              <li>Em Fields, selecione todos os campos disponiveis.</li>
              <li>Use o ID Finder para procurar a pagina pelo nome.</li>
              <li>Selecione o formulario correto e clique em Save.</li>
            </ul>
            <div className="grid gap-4 md:grid-cols-2">
              {facebookSteps.slice(2).map((item) => (
                <ScreenshotCard key={item.src} {...item} />
              ))}
              <ScreenshotCard
                src={asset("facebook-fields-saved.jpg")}
                title="Campos guardados"
                description="Confirme que os campos aparecem preenchidos antes de guardar."
              />
              <ScreenshotCard
                src={asset("facebook-saving.jpg")}
                title="Guardar configuracao"
                description="Clique em Save para guardar o modulo Facebook Lead Ads."
              />
            </div>
          </StepCard>

          <StepCard number="04" title="Ir buscar o webhook dentro do SENVIA OS">
            <p>
              O endereco do SENVIA OS e sempre o mesmo para toda a gente. O que muda de organizacao para organizacao
              e o <strong>token</strong> no fim do URL: e ele que identifica a sua conta e faz o lead entrar no CRM
              certo. Por isso o URL tem de ser copiado de dentro do SENVIA OS.
            </p>
            <CrmPath />
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                Entre no SENVIA OS e, no menu lateral, clique em <strong>Definicoes</strong>.
              </li>
              <li>
                Abra <strong>Integracoes</strong>. Vai ver os cartoes agrupados por tema.
              </li>
              <li>
                No grupo <strong>Automacoes</strong>, clique no cartao <strong>Webhook de Entrada</strong> — o que diz
                "Receber leads (Facebook, Zapier, Make)". Cuidado para nao escolher o "Webhook de Saida", que serve
                para o contrario.
              </li>
              <li>
                Confirme que o interruptor no canto superior direito esta <strong>ligado</strong>.
              </li>
              <li>
                Clique em <strong>Adicionar Webhook</strong>. Na janela <em>Novo Webhook de Entrada</em>, escreva um
                nome que identifique a origem (ex: Facebook Ads - Campanha Verao) e escolha a{" "}
                <strong>atribuicao de leads</strong>: sem atribuicao, responsavel fixo ou rotacao entre colaboradores.
                Depois clique em <strong>Criar webhook</strong>.
              </li>
              <li>
                No cartao do webhook criado, clique em <strong>Editar</strong>. Confirme que o estado no topo diz{" "}
                <strong>Ativo</strong>.
              </li>
              <li>
                No campo <strong>URL DO WEBHOOK</strong>, clique no botao de copiar ao lado da caixa. E este o URL que
                vai colar no Make, no passo 07.
              </li>
            </ol>
            <p>
              Nao quer criar um webhook novo? Cada organizacao ja tem um <strong>Webhook Principal</strong> criado
              automaticamente nesse mesmo ecra — pode abrir esse e copiar o URL da mesma forma.
            </p>
            <Button asChild variant="outline" className="gap-2">
              <a href={SETTINGS_WEBHOOKS_LINK} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Abrir Definicoes &gt; Integracoes
              </a>
            </Button>
            <WebhookUrlBlock />
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Trate este URL como uma palavra-passe: quem o tiver consegue criar leads na sua conta. Nao o publique
              nem o partilhe fora da equipa. Se achar que ficou exposto, crie um novo webhook no mesmo ecra e
              substitua o URL no Make.
            </p>
          </StepCard>

          <StepCard number="05" title="Adicionar o modulo HTTP">
            <p>Clique em Add module depois do modulo Facebook Lead Ads. Pesquise por HTTP e selecione o app HTTP.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <ScreenshotCard
                src={asset("facebook-app-starred.jpg")}
                title="Adicionar o segundo modulo"
                description="Clique no botao de adicionar modulo a seguir ao Facebook Lead Ads."
              />
              <ScreenshotCard
                src={asset("make-http-search.jpg")}
                title="Selecionar HTTP"
                description="Na pesquisa, escolha o app HTTP."
              />
            </div>
          </StepCard>

          <StepCard number="06" title="Escolher Make a request">
            <p>Dentro do app HTTP, selecione Make a request. Este e o modulo que envia dados por POST para o SENVIA OS.</p>
            <ScreenshotCard
              src={asset("make-http-module.jpg")}
              title="Modulo HTTP correto"
              description="Use Make a request para enviar o lead. Nao use Resolve URL para esta integracao."
            />
          </StepCard>

          <StepCard number="07" title="Configurar o pedido HTTP">
            <p>No modulo HTTP, configure os campos principais desta forma:</p>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-950">
                <span className="p-3">Campo</span>
                <span className="p-3">Valor</span>
              </div>
              {[
                ["Method", "POST — o Make abre este modulo em GET por omissao. Se nao mudar, o pedido falha sempre com \"Method Not Allowed\"."],
                ["URL", "O URL copiado no passo 04 (ja inclui o token da sua organizacao)"],
                ["Body type", "Raw"],
                ["Content type", "JSON (application/json)"],
                ["Headers", "So mexa aqui se o Content type acima nao acrescentar Content-Type sozinho. Se aparecer duplicado, apague um."],
              ].map(([field, value]) => (
                <div key={field} className="grid grid-cols-2 border-b border-slate-100 text-sm last:border-b-0">
                  <span className="p-3 font-semibold text-slate-950">{field}</span>
                  <span className="p-3 text-slate-600">{value}</span>
                </div>
              ))}
            </div>

            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Nunca escreva chavetas <code className="rounded bg-white px-1">{"{{ }}"}</code> a mao dentro do corpo (body).</strong>{" "}
              O Make usa esse simbolo para as suas proprias formulas — se escrever texto livre la dentro (por
              exemplo <code className="rounded bg-white px-1">{"{{full_name}}"}</code> digitado a mao), o pedido falha logo
              a validar com o erro <em>"The provided JSON body content is not valid JSON"</em>. O jeito certo esta a
              seguir.
            </p>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-4 py-3">
                <strong className="text-sm">Cole isto no corpo (Content)</strong>
                <CopyButton value={payload} />
              </div>
              <pre className="overflow-x-auto p-4 text-sm text-slate-100">
                <code>{payload}</code>
              </pre>
            </div>

            <ol className="list-decimal space-y-2 pl-5">
              <li>Cole o texto acima tal como esta, sem mudar nada primeiro.</li>
              <li>
                Faca duplo clique em cima de <code className="rounded bg-slate-100 px-1">NOME_AQUI</code> para o
                selecionar (fica destacado a azul).
              </li>
              <li>
                Sem escrever nada, clique no campo correspondente na lista de campos do Facebook Lead Ads, do lado
                direito do editor (a mesma lista que apareceu ao configurar o passo 03). O Make substitui o texto
                selecionado pelo marcador dele automaticamente.
              </li>
              <li>Repita para cada um dos outros marcadores em maiusculas.</li>
              <li>Acrescente mais linhas ao JSON se o formulario tiver outras perguntas que queira enviar.</li>
            </ol>

            <div className="overflow-hidden rounded-lg border border-red-200 bg-white">
              <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-900">
                Erros mais comuns neste passo
              </div>
              <div className="divide-y divide-red-100 text-sm">
                <div className="grid gap-1 p-3 sm:grid-cols-[1fr_1.4fr]">
                  <span className="font-semibold text-slate-950">"The provided JSON body content is not valid JSON"</span>
                  <span className="text-slate-600">Algum marcador foi escrito a mao com chavetas. Apague o corpo, cole outra vez o texto sem chavetas e use o clique nos campos, como acima.</span>
                </div>
                <div className="grid gap-1 p-3 sm:grid-cols-[1fr_1.4fr]">
                  <span className="font-semibold text-slate-950">"Method Not Allowed" / <code className="rounded bg-slate-100 px-1">{"{\"error\":\"Método não permitido\"}"}</code></span>
                  <span className="text-slate-600">O campo Method ainda esta em GET. Mude para POST no topo do modulo e corra outra vez — normalmente resolve sem precisar de enviar outro lead de teste.</span>
                </div>
              </div>
            </div>
          </StepCard>

          <StepCard number="08" title="Testar e ativar">
            <p>Clique em Run once no Make. O scenario fica a espera ("Waiting for data") de um lead real do formulario do Facebook.</p>
            <ScreenshotCard
              src={asset("make-waiting-save.jpg")}
              title="Aguardar lead de teste"
              description="Quando aparecer Waiting for data, envie um teste para confirmar que o scenario recebe os dados."
            />
            <p>
              Sem acesso a pagina de Facebook do cliente? Use a{" "}
              <a
                href="https://developers.facebook.com/tools/lead-ads-testing/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-blue-600 underline underline-offset-4"
              >
                Ferramenta de Teste de Lead Ads da Meta <ExternalLink className="inline h-3 w-3" />
              </a>{" "}
              (precisa de acesso de Business Manager a pagina) para simular um envio sem gastar em anuncios. Em
              alternativa, peca ao dono da conta para enviar um teste, ou preencha o formulario real uma vez com os
              seus proprios dados e apague depois na Central de Leads da Meta.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Confirme se o modulo Facebook recebeu os dados.</li>
              <li>Confirme se o modulo HTTP respondeu com sucesso (sem bolinha vermelha).</li>
              <li>Abra o SENVIA OS e verifique se o lead apareceu no CRM.</li>
              <li>Depois do teste, guarde e ative o scenario.</li>
            </ul>
          </StepCard>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_0.78fr]">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:p-7">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Checklist final</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {checklist.map((item) => (
                  <label key={item} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <input type="checkbox" className="mt-1 accent-blue-600" />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </div>

            <aside className="rounded-lg border border-blue-600/20 bg-blue-50 p-5 md:p-7">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Explicacao simples</h2>
              <p className="mt-4 text-slate-700">
                O formulario continua igual para quem preenche. A diferenca e que, assim que uma pessoa envia os dados,
                o Make recebe essa informacao e envia automaticamente para o SENVIA OS. O lead fica criado no CRM sem
                trabalho manual.
              </p>
              <div className="mt-5">
                <CopyButton value="Sempre que alguem preencher o formulario, o Make vai recolher os dados e envia-los automaticamente para o SENVIA OS. O lead fica criado no CRM sem ser necessario copiar, colar ou importar ficheiros." />
              </div>
            </aside>
          </div>
        </section>
      </main>
    </>
  );
}
