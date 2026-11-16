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
  label: string;
  path: string;
  icon: LucideIcon;
};

export const navigationItems: NavigationItem[] = [
  { label: "Overview", path: "/", icon: LayoutDashboard },
  { label: "Proxies", path: "/proxies", icon: Waypoints },
  { label: "Rules", path: "/rules", icon: Route },
  { label: "Connections", path: "/connections", icon: Cable },
  { label: "Profiles", path: "/profiles", icon: Files },
  { label: "Logs", path: "/logs", icon: ScrollText },
  { label: "Settings", path: "/settings", icon: Settings2 },
];

export function getPageTitle(pathname: string): string {
  const item = [...navigationItems]
    .reverse()
    .find(({ path }) => path !== "/" && pathname.startsWith(path));

  return item?.label ?? "Overview";
}
