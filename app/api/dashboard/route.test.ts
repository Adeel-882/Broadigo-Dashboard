import { beforeEach, describe, expect, it, vi } from "vitest";

const getDashboardData = vi.fn();
const isAuthenticatedRequest = vi.fn(async () => true);

vi.mock("@/lib/dashboard-data", () => ({ getDashboardData }));
vi.mock("@/lib/auth/session", () => ({ isAuthenticatedRequest }));

const { GET } = await import("@/app/api/dashboard/route");

const get = (query = "") => GET(new Request(`https://example.com/api/dashboard${query}`));

/** The shape Drizzle produces: the whole SQL in the message, driver error as cause. */
const drizzleFailure = () => {
  const cause = Object.assign(new Error("write CONNECT_TIMEOUT aws-0-ap-northeast-1.pooler.supabase.com:5432"), { code: "CONNECT_TIMEOUT" });
  return Object.assign(
    new Error("Failed query: select e.id, e.canonical_name, e.job_title, e.leadership_level, e.active,\n coalesce(bool_or(m.ranking_enabled), false) ranking_enabled\nparams: "),
    { cause },
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  isAuthenticatedRequest.mockResolvedValue(true);
});

describe("dashboard API error handling", () => {
  it("requires authentication", async () => {
    isAuthenticatedRequest.mockResolvedValue(false);
    expect((await get()).status).toBe(401);
    expect(getDashboardData).not.toHaveBeenCalled();
  });

  it.each(["Today", "Yesterday", "This Week", "Last Week", "This Month", "Last Month"])(
    "passes %s straight through to the data layer", async (period) => {
      getDashboardData.mockResolvedValue({ period, metrics: [] });
      const response = await get(`?period=${encodeURIComponent(period)}`);
      expect(response.status).toBe(200);
      expect(getDashboardData).toHaveBeenCalledWith(period, undefined, undefined);
    });

  it("falls back to This Week for an unknown period", async () => {
    getDashboardData.mockResolvedValue({ period: "This Week", metrics: [] });
    await get("?period=Someday");
    expect(getDashboardData).toHaveBeenCalledWith("This Week", undefined, undefined);
  });

  it("forwards custom range bounds", async () => {
    getDashboardData.mockResolvedValue({ period: "Custom Range", metrics: [] });
    await get("?period=Custom%20Range&start=2026-08-03&end=2026-08-07");
    expect(getDashboardData).toHaveBeenCalledWith("Custom Range", "2026-08-03", "2026-08-07");
  });

  it("never leaks the SQL statement to the browser", async () => {
    getDashboardData.mockRejectedValue(drizzleFailure());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get("?period=Yesterday");
    const body = await response.json() as { error: string; code: string; period: string; hint: string };

    expect(response.status).toBe(503);
    expect(body.error).toBe("Unable to load dashboard data for this period. Please try again.");
    expect(JSON.stringify(body)).not.toContain("select e.id");
    expect(JSON.stringify(body)).not.toContain("bool_or");
    expect(JSON.stringify(body)).not.toContain("Failed query");
    expect(body.code).toBe("CONNECT_TIMEOUT");
    expect(body.period).toBe("Yesterday");
    consoleError.mockRestore();
  });

  it("logs the underlying driver cause for the runtime log", async () => {
    getDashboardData.mockRejectedValue(drizzleFailure());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await get("?period=Yesterday");
    const logged = consoleError.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("[dashboard] period=Yesterday");
    expect(logged).toContain("CONNECT_TIMEOUT");
    consoleError.mockRestore();
  });

  it("still reports an invalid custom range as a 400 with its own message", async () => {
    getDashboardData.mockRejectedValue(new Error("A valid custom start and end date are required."));
    const response = await get("?period=Custom%20Range&start=2026-08-09&end=2026-08-03");
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe("A valid custom start and end date are required.");
  });
});
