import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_TAGS,
  readStoredLanguage,
  type LanguageId,
} from "./language";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

const resources = {
  en: { translation: en },
  "zh-CN": { translation: zhCN },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: LANGUAGE_TAGS[readInitialLanguage()],
  fallbackLng: LANGUAGE_TAGS[DEFAULT_LANGUAGE],
  interpolation: {
    // React escapes output already; i18next escaping would double-encode.
    escapeValue: false,
  },
  returnNull: false,
  react: {
    // Translations resolve synchronously from the bundle; suspending would
    // blank the shell for one frame and break the existing tests.
    useSuspense: false,
  },
});

function readInitialLanguage(): LanguageId {
  try {
    return readStoredLanguage(window.localStorage);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Switches the interface language and keeps `<html lang>` in sync. */
export function applyLanguage(language: LanguageId): void {
  const tag = LANGUAGE_TAGS[language];
  if (i18n.language !== tag) {
    void i18n.changeLanguage(tag);
  }
  document.documentElement.lang = tag;
}

export { i18n };
export type { LanguageId };