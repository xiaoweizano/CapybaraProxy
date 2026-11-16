import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LatencyGauge } from "./LatencyGauge";

describe("LatencyGauge", () => {
  it("shows an explicit unavailable state instead of a fabricated value", () => {
    render(<LatencyGauge value={null} />);

    expect(
      screen.getByRole("img", { name: "Latency not measured" }),
    ).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(document.querySelector(".latency-gauge-cap")).not.toBeInTheDocument();
  });

  it("rejects invalid negative values", () => {
    render(<LatencyGauge value={-4} />);

    expect(
      screen.getByRole("img", { name: "Latency not measured" }),
    ).toBeInTheDocument();
  });

  it("shows the gauge cap only when a latency value is available", () => {
    render(<LatencyGauge value={42} />);

    expect(document.querySelector(".latency-gauge-cap")).toBeInTheDocument();
  });
});
