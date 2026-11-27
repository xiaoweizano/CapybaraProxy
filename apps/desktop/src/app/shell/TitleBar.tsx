import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { getPageTitleKey } from "../navigation";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";

export function TitleBar() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const pageTitle = t(`nav.${getPageTitleKey(pathname)}`);

  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        <span className="titlebar-kicker">CapybaraProxy</span>
        <span className="titlebar-divider" aria-hidden="true">
          /
        </span>
        <span className="titlebar-page">{pageTitle}</span>
      </div>
      <div className="titlebar-actions">
        <ThemeToggle />
        <WindowControls />
      </div>
    </header>
  );
}