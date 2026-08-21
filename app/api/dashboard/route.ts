import { getDashboardData } from "@/lib/dashboard-data";
import { isAuthenticatedRequest } from "@/lib/auth/session";
import { describeDbError } from "@/lib/db/client";
import type { PeriodKey } from "@/types/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const periods = new Set<PeriodKey>(["Today", "Yesterday", "This Week", "Last Week", "This Month", "Last Month", "Custom Range"]);

/** Invalid custom ranges are the caller's fault; everything else is ours. */
const isValidationError = (error: unknown) =>
  error instanceof Error && /valid custom start and end date|valid ISO date/i.test(error.message);

export async function GET(request: Request) {
  if (!(await isAuthenticatedRequest(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const value = url.searchParams.get("period") as PeriodKey;
  const period = periods.has(value) ? value : "This Week";
  const start = url.searchParams.get("start") ?? undefined;
  const end = url.searchParams.get("end") ?? undefined;

  try {
    return Response.json(await getDashboardData(period, start, end));
  } catch (error) {
    if (isValidationError(error)) {
      return Response.json({ error: (error as Error).message }, { status: 400 });
    }
    // Drizzle's message embeds the entire failing SQL statement. It belongs in
    // the runtime log, never in a browser response.
    const { chain, root, code } = describeDbError(error);
    console.error(`[dashboard] period=${period}${start ? ` start=${start}` : ""}${end ? ` end=${end}` : ""} failed`);
    chain.forEach((line, index) => console.error(`[dashboard]   ${index === 0 ? "error" : "cause"}: ${line}`));
    return Response.json({
      error: "Unable to load dashboard data for this period. Please try again.",
      code: code ?? "DASHBOARD_QUERY_FAILED",
      period,
      hint: root.slice(0, 120),
    }, { status: 503 });
  }
}
