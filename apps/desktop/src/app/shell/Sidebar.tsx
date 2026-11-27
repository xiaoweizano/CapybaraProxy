import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { BrandMark } from "../../shared/components/BrandMark";
import { navigationItems } from "../navigation";

export function Sidebar() {
  const { t } = useTranslation();

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

      <div className="sidebar-foot" aria-hidden="true">
        <span className="sidebar-foot-line" />
        <span>FP / 01</span>
      </div>
    </aside>
  );
}
