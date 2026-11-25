import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar } from "../app/shell/Sidebar";
import { applyLanguage } from "./index";

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("language switching", () => {
  afterEach(() => {
    applyLanguage("english");
  });

  it("renders English navigation by default", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders Chinese navigation after switching language", async () => {
    applyLanguage("simplified_chinese");
    renderSidebar();

    expect(await screen.findByRole("link", { name: "概览" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("keeps the document language in sync with the interface", () => {
    applyLanguage("simplified_chinese");
    expect(document.documentElement.lang).toBe("zh-CN");

    applyLanguage("english");
    expect(document.documentElement.lang).toBe("en");
  });
});