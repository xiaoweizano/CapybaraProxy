import {
  Cable,
  Files,
  LayoutDashboard,
  Route,
  ScrollText,
  Settings2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  /** Translation key under `nav.*`; also used for the window title. */
  key: "overview" | "proxies" | "rules" | "connections" | "profiles" | "logs" | "settings";
  path: string;
  icon: LucideIcon;
};

export const navigationItems: NavigationItem[] = [
  { key: "overview", path: "/", icon: LayoutDashboard },
  { key: "proxies", path: "/proxies", icon: Waypoints },
  { key: "rules", path: "/rules", icon: Route },
  { key: "connections", path: "/connections", icon: Cable },
  { key: "profiles", path: "/profiles", icon: Files },
  { key: "logs", path: "/logs", icon: ScrollText },
  { key: "settings", path: "/settings", icon: Settings2 },
];

/** Returns the translation key of the workspace that owns `pathname`. */
export function getPageTitleKey(
  pathname: string,
): NavigationItem["key"] {
  const item = [...navigationItems]
    .reverse()
    .find(({ path }) => path !== "/" && pathname.startsWith(path));

  return item?.key ?? "overview";
}