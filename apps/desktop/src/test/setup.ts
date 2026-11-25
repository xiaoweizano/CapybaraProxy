import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import "../i18n";
import { i18n } from "../i18n";
import { LANGUAGE_TAGS, DEFAULT_LANGUAGE } from "../i18n/language";

// Lazy route chunks can take over the default 1s under parallel workers.
configure({ asyncUtilTimeout: 10_000 });

afterEach(async () => {
  cleanup();
  localStorage.clear();
  // A test that switches language must not leak into the next one.
  await i18n.changeLanguage(LANGUAGE_TAGS[DEFAULT_LANGUAGE]);
});