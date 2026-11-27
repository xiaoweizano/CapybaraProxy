import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { BrandMark } from "../../shared/components/BrandMark";
import {
  readStoredSidebar,
  sidebarAttribute,
  writeStoredSidebar,
  type SidebarPreference,
} from "../../shared/sidebarView";
import { navigationItems } from "../navigation";

export function Sidebar() {
  const { t } = useTranslation();
  const [preference, setPreference] = useState<SidebarPreference>(() =>
    readStoredSidebar(window.localStorage),
  );

  // The attribute drives the layout; an empty value means "let the window
  // width decide".
  useEffect(() => {
    const attribute = sidebarAttribute(preference);
    if (attribute === "") {
      delete document.documentElement.dataset.sidebar;
    } else {
      document.documentElement.dataset.sidebar = attribute;
    }
  }, [preference]);

  const toggle = () => {
    const next: SidebarPreference =
      preference === "collapsed" ? "expanded" : "collapsed";
    setPreference(next);
    writeStoredSidebar(window.localStorage, next);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand" aria-label={t("nav.home")}>
        <BrandMark className="sidebar-brand-mark" />
        <div className="sidebar-brand-copy">
          <strong>CapybaraProxy</strong>
          <span>{t("app.tagline")}</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label={t("nav.primary")}>
        {navigationItems.map(({ key, path, icon: Icon }) => {
          const label = t(`nav.${key}`);
          return (
            <NavLink
              key={path}
              className={({ isActive }) =>
                `sidebar-link${isActive ? " is-active" : ""}`
              }
              to={path}
              end={path === "/"}
              aria-label={label}
              title={label}
            >
              <Icon
                className="sidebar-link-icon"
                aria-hidden="true"
                size={17}
                strokeWidth={1.8}
              />
              <span className="sidebar-link-label">{label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <span className="sidebar-foot-line" aria-hidden="true" />
        <button
          className="sidebar-collapse"
          type="button"
          aria-label={
            preference === "collapsed"
              ? t("shell.expandSidebar")
              : t("shell.collapseSidebar")
          }
          title={
            preference === "collapsed"
              ? t("shell.expandSidebar")
              : t("shell.collapseSidebar")
          }
          onClick={toggle}
        >
          {preference === "collapsed" ? (
            <ChevronsRight aria-hidden="true" size={15} />
          ) : (
            <ChevronsLeft aria-hidden="true" size={15} />
          )}
          <span className="sidebar-collapse-label">
            {t("shell.collapseSidebar")}
          </span>
        </button>
      </div>
    </aside>
  );
}
