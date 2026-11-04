import { Link } from "react-router-dom";
import { ArrowRight, GraduationCap, Plug } from "lucide-react";
import { SEO } from "@/components/SEO";
import { useLanguage } from "@/i18n";

type Tutorial = {
  to: string;
  title: string;
  description: string;
  tag: string;
  duration: string;
};

const tutorials: Tutorial[] = [
  {
    to: "/tutoriais/make",
    title: "Make + Facebook Lead Ads",
    description:
      "Receber automaticamente no SENVIA OS as leads dos formulários do Facebook, usando o Make e o webhook de entrada da sua organização.",
    tag: "Integrações",
    duration: "8 passos",
  },
];

export default function Tutoriais() {
  const { t } = useLanguage();
  return (
    <>
      <SEO
        title={t("Tutoriais")}
        description={t("Guias passo a passo para configurar o SENVIA OS.")}
        canonical="/tutoriais"
      />

      <main className="min-h-screen bg-slate-50 text-slate-950">
        <header className="border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">SENVIA OS</p>
            <h1 className="text-xl font-black tracking-tight">{t("Tutoriais")}</h1>
          </div>
        </header>

        <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-blue-600/20 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
            <GraduationCap className="h-4 w-4" />
            {t("Guias para configurar sozinho")}
          </p>
          <h2 className="max-w-3xl text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl">
            {t("Guias passo a passo do SENVIA OS.")}
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-slate-600">
            {t("Cada guia mostra o processo completo, com imagens reais de cada ecrã. Pode segui-lo sozinho ou enviar o link a quem trata da configuração.")}
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {tutorials.map((tutorial) => (
              <Link
                key={tutorial.to}
                to={tutorial.to}
                className="group flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md md:p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-blue-600/20 bg-blue-50 text-blue-700">
                    <Plug className="h-5 w-5" />
                  </span>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold text-blue-700">
                    <span className="rounded-full bg-blue-50 px-2.5 py-1">{t(tutorial.tag)}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{t(tutorial.duration)}</span>
                  </div>
                </div>
                <h3 className="mt-4 text-xl font-bold tracking-tight">{tutorial.title}</h3>
                <p className="mt-2 flex-1 text-sm text-slate-600">{t(tutorial.description)}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
                  {t("Abrir tutorial")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
