import { NavLink } from "react-router-dom";
import { BrandMark } from "../../shared/components/BrandMark";
import { navigationItems } from "../navigation";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand" aria-label="FlowProxy home">
        <BrandMark className="sidebar-brand-mark" />
        <div className="sidebar-brand-copy">
          <strong>FlowProxy</strong>
          <span>Personal network cockpit</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navigationItems.map(({ label, path, icon: Icon }) => (
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
        ))}
      </nav>

      <div className="sidebar-foot" aria-hidden="true">
        <span className="sidebar-foot-line" />
        <span>FP / 01</span>
      </div>
    </aside>
  );
}
