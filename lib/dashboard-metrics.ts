export type EmployeePrimaryMetric = "appointments" | "revenue" | "leads" | "work";

export function primaryMetricForTitle(jobTitle: string): EmployeePrimaryMetric {
  const title = jobTitle.toLowerCase();
  if (title.includes("closer")) return "revenue";
  if (title.includes("appointment setter")) return "appointments";
  if (title.includes("inside sales")) return "leads";
  if (title.includes("media")) return "work";
  return "appointments";
}
