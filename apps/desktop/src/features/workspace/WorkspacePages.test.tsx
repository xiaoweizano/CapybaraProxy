import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeContext,
  type RuntimeContextValue,
} from "../../app/runtime/runtimeContext";
import { SettingsProvider } from "../../app/settings/SettingsProvider";
import {
  clearSubscription,
  closeAllConnections,
  closeConnection,
  getConnections,
  getProfiles,
  getRules,
  importSubscription,
  importSubscriptionFromUrl,
  type ConnectionPage,
  type ConnectionSummary,
  type ProfileInfo,
  type ProxyGroup,
  type RuntimeSnapshot,
} from "../../platform/runtime";
import { ConnectionsPage } from "../connections/ConnectionsPage";
import { LogsPage } from "../logs/LogsPage";
import { ProfilesPage } from "../profiles/ProfilesPage";
import { ProxiesPage } from "../proxies/ProxiesPage";
import { RulesPage } from "../rules/RulesPage";

vi.mock("../../platform/runtime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../platform/runtime")>();
  return {
    ...actual,
    clearSubscription: vi.fn(),
    closeAllConnections: vi.fn(),
    closeConnection: vi.fn(),
    getConnections: vi.fn(),
    getProfiles: vi.fn(),
    getRules: vi.fn(),
    getSubscriptionSnapshot: vi.fn(),
    subscribeSubscriptionUpdated: vi.fn(async () => () => undefined),
    refreshSubscription: vi.fn(),
    importSubscription: vi.fn(),
    importSubscriptionFromUrl: vi.fn(),
  };
});

const clearSubscriptionMock = vi.mocked(clearSubscription);
const importSubscriptionMock = vi.mocked(importSubscription);
const importSubscriptionFromUrlMock = vi.mocked(importSubscriptionFromUrl);
const getConnectionsMock = vi.mocked(getConnections);
const getProfilesMock = vi.mocked(getProfiles);
const getRulesMock = vi.mocked(getRules);
const closeConnectionMock = vi.mocked(closeConnection);
const closeAllConnectionsMock = vi.mocked(closeAllConnections);

const connectedSnapshot: RuntimeSnapshot = {
  backend: "mihomo",
  state: "connected",
  sequence: 2,
  started_at_ms: 1_760_000_000_000,
  last_error: null,
  log_count: 2,
};

const proxyGroups: ProxyGroup[] = [
  {
    name: "Proxy",
    group_type: "Selector",
    selected: "Tokyo 01",
    nodes: [
      {
        name: "Tokyo 01",
        proxy_type: "Shadowsocks",
        udp: true,
        delay_ms: 42,
        alive: true,
      },
      {
        name: "Singapore 01",
        proxy_type: "VLESS",
        udp: true,
        delay_ms: null,
        alive: true,
      },
    ],
  },
];

const sampleConnection: ConnectionSummary = {
  id: "connection-1",
  host: "example.com",
  destination_ip: "203.0.113.10",
  destination_port: 443,
  network: "tcp",
  rule: "DomainSuffix",
  rule_payload: "example.com",
  chains: ["Proxy", "Tokyo 01"],
  upload_bytes: 1_024,
  download_bytes: 2_048,
  started_at_ms: 1_760_000_000_000,
};

const connectionPage: ConnectionPage = {
  upload_total_bytes: 2_048,
  download_total_bytes: 4_096,
  memory_bytes: 8_192,
  connections: [sampleConnection],
};

const connectedProfile: ProfileInfo = {
  id: "profile-1",
  name: "Primary profile",
  active: true,
  updated_at_ms: 1_760_000_000_000,
  source: null,
  proxy_count: null,
};

const importedProfile: ProfileInfo = {
  id: "flowproxy-subscription",
  name: "Imported subscription",
  active: true,
  updated_at_ms: 1_760_000_000_000,
  source: "subscription",
  proxy_count: 42,
};

function runtimeValue(
  overrides: Partial<RuntimeContextValue> = {},
): RuntimeContextValue {
  return {
    snapshot: connectedSnapshot,
    coreInfo: { backend: "mihomo", version: "v1.19.33", pid: 42 },
    proxyGroups,
    corePreferences: { mode: "rule", log_level: "warning" },
    logs: [
      {
        sequence: 1,
        timestamp_ms: 1_760_000_000_000,
        level: "info",
        message: "Mihomo core is ready.",
        error_code: null,
      },
    ],
    isLoading: false,
    pendingAction: null,
    notice: null,
    lastError: null,
    refresh: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    selectProxy: vi.fn(async () => undefined),
    measureDelay: vi.fn(async () => 88),
    measureGroupDelay: vi.fn(async () => ({})),
    setRoutingMode: vi.fn(async () => undefined),
    setCoreLogLevel: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderWithRuntime(node: ReactNode, value = runtimeValue()) {
  return render(
    <SettingsProvider>
      <RuntimeContext.Provider value={value}>
        <MemoryRouter>{node}</MemoryRouter>
      </RuntimeContext.Provider>
    </SettingsProvider>,
  );
}

describe("real data workspace pages", () => {
  beforeEach(() => {
    getConnectionsMock.mockReset().mockResolvedValue({
      status: "ok",
      data: connectionPage,
    });
    getProfilesMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [
        {
          id: "profile-1",
          name: "Primary profile",
          active: true,
          updated_at_ms: 1_760_000_000_000,
          source: null,
          proxy_count: null,
        },
      ],
    });
    getRulesMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [
        {
          index: 0,
          rule_type: "DOMAIN-SUFFIX",
          payload: "example.com",
          proxy: "Proxy",
        },
      ],
    });
    closeConnectionMock.mockReset().mockResolvedValue({
      status: "ok",
      data: null,
    });
    closeAllConnectionsMock.mockReset().mockResolvedValue({
      status: "ok",
      data: null,
    });
  });

  it("renders real proxy groups and delegates selection and delay tests", async () => {
    const user = userEvent.setup();
    const value = runtimeValue();
    renderWithRuntime(<ProxiesPage />, value);

    expect(
      screen.getByRole("heading", { name: "Proxy groups" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tokyo 01")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Select Singapore 01" }),
    );
    expect(value.selectProxy).toHaveBeenCalledWith("Proxy", "Singapore 01");

    await user.click(
      screen.getByRole("button", { name: "Test delay for Tokyo 01" }),
    );
    await waitFor(() => {
      expect(value.measureDelay).toHaveBeenCalledWith("Tokyo 01");
    });
    expect(await screen.findByText("88 ms")).toBeInTheDocument();
  });

  it("filters proxy groups and nodes and sorts by latency", async () => {
    const user = userEvent.setup();
    renderWithRuntime(<ProxiesPage />);

    expect(await screen.findByText("Tokyo 01")).toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: "Filter proxy groups and nodes" }),
      "singapore",
    );
    expect(screen.queryByText("Tokyo 01")).not.toBeInTheDocument();
    expect(screen.getByText("Singapore 01")).toBeInTheDocument();

    await user.clear(
      screen.getByRole("searchbox", { name: "Filter proxy groups and nodes" }),
    );
    await user.click(screen.getByRole("button", { name: "By latency" }));

    const nodes = screen.getAllByText(/^(Tokyo 01|Singapore 01)$/);
    // Tokyo has a measured delay, Singapore has none, so it sorts first.
    expect(nodes[0]).toHaveTextContent("Tokyo 01");
  });

  it("loads rules from Mihomo and shows its empty state without invented rows", async () => {
    const user = userEvent.setup();
    renderWithRuntime(<RulesPage />);

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("DOMAIN-SUFFIX")).toBeInTheDocument();
    expect(getRulesMock).toHaveBeenCalledTimes(1);

    await user.type(
      screen.getByRole("searchbox", { name: "Filter rules" }),
      "nomatch",
    );
    expect(screen.queryByText("example.com")).not.toBeInTheDocument();
    expect(
      screen.getByText("No rule matches “nomatch”."),
    ).toBeInTheDocument();
  });

  it("loads connections and closes a selected connection once", async () => {
    const user = userEvent.setup();
    renderWithRuntime(<ConnectionsPage />);

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    const closeButton = screen.getByRole("button", {
      name: "Close connection example.com",
    });
    await user.dblClick(closeButton);

    expect(closeConnectionMock).toHaveBeenCalledTimes(1);
    expect(closeConnectionMock).toHaveBeenCalledWith("connection-1");
    await waitFor(() => {
      expect(
        screen.queryByText("example.com"),
      ).not.toBeInTheDocument();
    });
    expect(getConnectionsMock).toHaveBeenCalledTimes(2);
  });

  it("filters connections and closes every connection after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithRuntime(<ConnectionsPage />);

    expect(await screen.findByText("example.com")).toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: "Filter connections" }),
      "nomatch",
    );
    expect(screen.queryByText("example.com")).not.toBeInTheDocument();
    expect(
      screen.getByText("No connection matches “nomatch”."),
    ).toBeInTheDocument();

    await user.clear(
      screen.getByRole("searchbox", { name: "Filter connections" }),
    );
    await user.click(screen.getByRole("button", { name: "Close all" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(closeAllConnectionsMock).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("paginates large connection lists and keeps only one page rendered", async () => {    const user = userEvent.setup();
    getConnectionsMock.mockResolvedValueOnce({
      status: "ok",
      data: {
        ...connectionPage,
        connections: Array.from({ length: 160 }, (_, index) => ({
          ...sampleConnection,
          id: `connection-${index + 1}`,
          host: `connection-${index + 1}.example.com`,
        })),
      },
    });

    renderWithRuntime(<ConnectionsPage />);

    expect(await screen.findByText("connection-1.example.com")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Close connection / }),
    ).toHaveLength(50);
    expect(screen.getByText("Page 1 of 4")).toBeInTheDocument();
    expect(
      screen.queryByText("connection-51.example.com"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Next connections page" }),
    );

    expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
    expect(screen.getByText("connection-51.example.com")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Close connection / }),
    ).toHaveLength(50);
  });

  it("loads profiles and marks only the native active profile", async () => {
    renderWithRuntime(<ProfilesPage />);

    expect(await screen.findByText("Primary profile")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(getProfilesMock).toHaveBeenCalledTimes(1);
  });

  it("imports a subscription from a pasted URL and keeps the form available", async () => {
    const user = userEvent.setup();
    renderWithRuntime(<ProfilesPage />);
    await screen.findByText("Primary profile");

    importSubscriptionFromUrlMock.mockResolvedValueOnce({
      status: "ok",
      data: [importedProfile],
    });
    getProfilesMock.mockResolvedValueOnce({ status: "ok", data: [importedProfile] });

    await user.type(screen.getByLabelText("Name"), "My provider");
    await user.type(
      screen.getByLabelText("Subscription URL"),
      "https://provider.example.com/sub?token=secret",
    );
    await user.click(
      screen.getByRole("button", { name: "Import subscription" }),
    );

    await waitFor(() => {
      expect(importSubscriptionFromUrlMock).toHaveBeenCalledWith(
        "My provider",
        "https://provider.example.com/sub?token=secret",
      );
    });
    expect(await screen.findByText("Imported subscription")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import subscription" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Importing a subscription replaces the current one."),
    ).toBeInTheDocument();
  });

  it("reports a subscription import failure without hiding the form", async () => {
    const user = userEvent.setup();
    renderWithRuntime(<ProfilesPage />);
    await screen.findByText("Primary profile");

    importSubscriptionMock.mockResolvedValueOnce({
      status: "error",
      error: {
        code: "subscription_invalid",
        message: "The subscription document has no proxies or proxy-providers section.",
        retryable: false,
      },
    });

    await user.type(screen.getByLabelText("Name"), "Broken");
    await user.click(screen.getByRole("tab", { name: /Paste YAML/ }));
    // `userEvent.type` treats `[` as a key descriptor, so paste the YAML.
    await user.click(screen.getByLabelText("Subscription YAML"));
    await user.paste("cHJveGllczogW10=");
    await user.click(
      screen.getByRole("button", { name: "Import subscription" }),
    );

    expect(
      await screen.findByText(/has no proxies or proxy-providers section/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import subscription" }),
    ).toBeInTheDocument();
  });

  it("removes an imported subscription", async () => {
    const user = userEvent.setup();
    getProfilesMock.mockResolvedValueOnce({
      status: "ok",
      data: [importedProfile],
    });
    clearSubscriptionMock.mockResolvedValueOnce({
      status: "ok",
      data: [connectedProfile],
    });
    getProfilesMock.mockResolvedValueOnce({
      status: "ok",
      data: [connectedProfile],
    });

    renderWithRuntime(<ProfilesPage />);
    await screen.findByText("Imported subscription");

    await user.click(
      screen.getByRole("button", { name: "Remove subscription" }),
    );

    await waitFor(() => {
      expect(clearSubscriptionMock).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/direct profile is active again/),
    ).toBeInTheDocument();
  });

  it("shows bounded Runtime logs from the shared provider", () => {
    renderWithRuntime(<LogsPage />);

    expect(screen.getByText("Mihomo core is ready.")).toBeInTheDocument();
    expect(screen.getByText("1 event")).toBeInTheDocument();
  });

  it("does not request Mihomo resources while the Runtime is stopped", async () => {
    const stopped = runtimeValue({
      snapshot: { ...connectedSnapshot, state: "stopped" },
      coreInfo: null,
      proxyGroups: [],
    });
    renderWithRuntime(<RulesPage />, stopped);

    expect(await screen.findByText("Mihomo is not connected")).toBeInTheDocument();
    expect(getRulesMock).not.toHaveBeenCalled();
  });
});
