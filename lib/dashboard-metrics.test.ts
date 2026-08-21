import { describe, expect, it } from "vitest";
import { primaryMetricForTitle } from "@/lib/dashboard-metrics";

describe("employee primary dashboard metric", () => {
  it.each([
    ["Closer · Hybrid Media", "revenue"],
    ["Appointment Setter · Hybrid Media", "appointments"],
    ["Inside Sales Agent", "leads"],
    ["Media Operations", "work"],
  ] as const)("maps %s to %s", (title, metric) => {
    expect(primaryMetricForTitle(title)).toBe(metric);
  });
});
