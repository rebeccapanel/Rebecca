import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import HttpApi from "i18next-http-backend"
import { initReactI18next } from "react-i18next"

export type Locale = "en" | "fa" | "ru" | "zh"

export const SUPPORTED_LOCALES: ReadonlyArray<{ code: Locale; label: string; native: string; dir: "ltr" | "rtl" }> = [
  { code: "en", label: "English", native: "English", dir: "ltr" },
  { code: "fa", label: "Persian", native: "فارسی", dir: "rtl" },
  { code: "ru", label: "Russian", native: "Русский", dir: "ltr" },
  { code: "zh", label: "Chinese", native: "中文", dir: "ltr" },
]

const STORAGE_KEY = "rebecca.lang"

export function directionOf(locale: string): "ltr" | "rtl" {
  return locale.startsWith("fa") || locale.startsWith("ar") || locale.startsWith("he") ? "rtl" : "ltr"
}

export function applyDocumentLocale(locale: string) {
  if (typeof document === "undefined") return
  const dir = directionOf(locale)
  document.documentElement.setAttribute("lang", locale)
  document.documentElement.setAttribute("dir", dir)
  document.documentElement.dataset.dir = dir
}

i18n
  .use(HttpApi)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: ["en", "fa", "ru", "zh"],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    detection: {
      // `?lang=fa` wins so a shareable link can pin the interface language.
      order: ["querystring", "localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: STORAGE_KEY,
      lookupQuerystring: "lang",
    },
    backend: {
      // Served from `public/statics/locales` — the same JSON files the previous
      // dashboard shipped, so both dashboards speak identical terminology.
      loadPath: "/statics/locales/{{lng}}.json",
    },
  })

i18n.on("languageChanged", (locale) => {
  applyDocumentLocale(locale)
  document.documentElement.style.setProperty("--app-locale", `"${locale}"`)
})

applyDocumentLocale(i18n.language || "en")

export default i18n
