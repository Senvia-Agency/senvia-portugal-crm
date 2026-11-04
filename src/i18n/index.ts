import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { enGB, pt, ptBR as ptBRDates, type Locale } from "date-fns/locale";
import { en } from "./en";
import { ptBR } from "./pt-BR";

/**
 * System language. The keys are the pt-PT text itself (gettext style): pt-PT
 * needs no dictionary, and a text not translated yet shows in pt-PT rather than
 * as a code. Wrap a text with t("…") and add it to pt-BR.ts and en.ts.
 */
export const LANGUAGES = [
  { code: "pt-PT", label: "Português (Portugal)", short: "PT" },
  { code: "pt-BR", label: "Português (Brasil)", short: "BR" },
  { code: "en", label: "English", short: "EN" },
] as const;
export type Language = typeof LANGUAGES[number]["code"];

const STORAGE_KEY = "senvia-language-v1";
const isLanguage = (v: unknown): v is Language => LANGUAGES.some(l => l.code === v);

function savedLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch { /* storage blocked: default */ }
  return "pt-PT";
}

/** Each module keeps its own dictionary in ./modules/<module>.ts (export const ptBR, en). */
const modules = import.meta.glob<{ ptBR?: Record<string, string>; en?: Record<string, string> }>("./modules/*.ts", { eager: true });
const merged = (pick: "ptBR" | "en", base: Record<string, string>) =>
  Object.values(modules).reduce<Record<string, string>>((all, mod) => ({ ...all, ...(mod[pick] ?? {}) }), { ...base });

void i18n.use(initReactI18next).init({
  resources: { "pt-PT": { translation: {} }, "pt-BR": { translation: merged("ptBR", ptBR) }, en: { translation: merged("en", en) } },
  lng: savedLanguage(),
  fallbackLng: false,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  react: { useSuspense: false },
});
document.documentElement.lang = i18n.language;

export function setLanguage(language: Language) {
  try { localStorage.setItem(STORAGE_KEY, language); } catch { /* this visit only */ }
  document.documentElement.lang = language;
  void i18n.changeLanguage(language);
}

export const currentLanguage = (): Language => (isLanguage(i18n.language) ? i18n.language : "pt-PT");

const DATE_LOCALES: Record<Language, Locale> = { "pt-PT": pt, "pt-BR": ptBRDates, en: enGB };
const INTL_LOCALES: Record<Language, string> = { "pt-PT": "pt-PT", "pt-BR": "pt-BR", en: "en-GB" };

/** date-fns locale of the chosen language. */
export const dateLocale = () => DATE_LOCALES[currentLanguage()];
/** Intl locale of the chosen language (numbers and dates). */
export const intlLocale = () => INTL_LOCALES[currentLanguage()];

/** Outside React (hooks' computed strings, lists defined at module level). */
export const tr = (text: string, options?: Record<string, unknown>) => i18n.t(text, options) as string;

/** The language and a translator, re-rendering when the language changes. */
export function useLanguage() {
  const { t, i18n: instance } = useTranslation();
  const language = isLanguage(instance.language) ? instance.language : "pt-PT";
  return { t: t as (text: string, options?: Record<string, unknown>) => string, language, setLanguage };
}

export default i18n;
