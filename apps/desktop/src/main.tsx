import "@fontsource-variable/manrope";
import "@fontsource-variable/sora";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import {
  DEFAULT_THEME,
  readStoredTheme,
} from "./app/theme/theme";
import "./styles/global.css";
import "./styles/shell.css";
import "./styles/settings.css";
import "./styles/workspace.css";
import "./features/overview/overview.css";
import "./features/runtime/mihomo-core.css";

try {
  document.documentElement.dataset.theme = readStoredTheme(window.localStorage);
} catch {
  document.documentElement.dataset.theme = DEFAULT_THEME;
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("FlowProxy root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
