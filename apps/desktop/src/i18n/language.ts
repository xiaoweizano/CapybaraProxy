/**
 * Interface languages FlowProxy ships.
 *
 * The identifier matches the `Language` enum on the Rust side so the value can
 * round-trip through `settings.json` unchanged.
 */
export type LanguageId = "english" | "simplified_chinese";

export const DEFAULT_LANGUAGE: LanguageId = "english";

const STORAGE_KEY = "flowproxy.language";

/** BCP-47 tags handed to i18next and to `Intl`. */
export const LANGUAGE_TAGS: Record<LanguageId, string> = {
  english: "en",
  simplified_chinese: "zh-CN",
};

export function isLanguage(value: unknown): value is LanguageId {
  return value === "english" || value === "simplified_chinese";
}

export function readStoredLanguage(storage: Storage): LanguageId {
  const stored = storage.getItem(STORAGE_KEY);
  return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
}

export function writeStoredLanguage(storage: Storage, language: LanguageId): void {
  storage.setItem(STORAGE_KEY, language);
}

/**
 * Best guess for the first launch. Only used to seed the preview cache; the
 * native settings store stays authoritative once it responds.
 */
export function detectSystemLanguage(): LanguageId {
  const candidates =
    typeof navigator === "undefined"
      ? []
      : [...(navigator.languages ?? []), navigator.language];

  return candidates.some((tag) => tag?.toLowerCase().startsWith("zh"))
    ? "simplified_chinese"
    : DEFAULT_LANGUAGE;
}