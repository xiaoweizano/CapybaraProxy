import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { RuntimeProvider } from "./runtime/RuntimeProvider";
import { SettingsProvider } from "./settings/SettingsProvider";
import { AppShell } from "./shell/AppShell";
import { SystemIntegrationProvider } from "./systemIntegration/SystemIntegrationProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import { useDocumentVisibility } from "./useDocumentVisibility";

const OverviewPage = lazy(() =>
  import("../features/overview/OverviewPage").then(({ OverviewPage }) => ({
    default: OverviewPage,
  })),
);
const ProxiesPage = lazy(() =>
  import("../features/proxies/ProxiesPage").then(({ ProxiesPage }) => ({
    default: ProxiesPage,
  })),
);
const RulesPage = lazy(() =>
  import("../features/rules/RulesPage").then(({ RulesPage }) => ({
    default: RulesPage,
  })),
);
const ConnectionsPage = lazy(() =>
  import("../features/connections/ConnectionsPage").then(
    ({ ConnectionsPage }) => ({ default: ConnectionsPage }),
  ),
);
const ProfilesPage = lazy(() =>
  import("../features/profiles/ProfilesPage").then(({ ProfilesPage }) => ({
    default: ProfilesPage,
  })),
);
const LogsPage = lazy(() =>
  import("../features/logs/LogsPage").then(({ LogsPage }) => ({
    default: LogsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
);

function AppRuntime() {
  useDocumentVisibility();

  return null;
}

export function App() {
  const { t } = useTranslation();

  return (
    <SettingsProvider>
      <ThemeProvider>
        <AppRuntime />
        <RuntimeProvider>
          <HashRouter>
            <Suspense
              fallback={
                <div className="workspace-loading" role="status">
                  {t("workspace.loadingPage")}
                </div>
              }
            >
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="proxies" element={<ProxiesPage />} />
                  <Route path="rules" element={<RulesPage />} />
                  <Route path="connections" element={<ConnectionsPage />} />
                  <Route path="profiles" element={<ProfilesPage />} />
                  <Route path="logs" element={<LogsPage />} />
                  <Route
                    path="settings"
                    element={
                      <SystemIntegrationProvider>
                        <SettingsPage />
                      </SystemIntegrationProvider>
                    }
                  />
                  <Route path="*" element={<Navigate replace to="/" />} />
                </Route>
              </Routes>
            </Suspense>
          </HashRouter>
        </RuntimeProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}
