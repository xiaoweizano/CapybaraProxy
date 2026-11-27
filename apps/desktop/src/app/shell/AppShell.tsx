import { Outlet } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

export function AppShell() {
  return (
    <div className="app-frame">
      <Sidebar />
      <div className="app-workspace">
        <TitleBar />
        <main className="page-viewport">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
