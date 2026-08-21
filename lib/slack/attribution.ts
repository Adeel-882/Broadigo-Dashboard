import type { ParsedRecordType, ParseResult } from "@/lib/parsers/types";

type IdentityLookup = ReadonlyMap<string, string>;

export type StructuredAttribution = {
  employeeId: string | null;
  warnings: string[];
};

export function resolveStructuredAttribution(
  recordType: ParsedRecordType,
  authorEmployeeId: string | null | undefined,
  values: ParseResult["values"],
  identityBySlackUser: IdentityLookup,
): StructuredAttribution {
  if (recordType !== "DOCK") return { employeeId: authorEmployeeId ?? null, warnings: [] };

  const targetSlackUserIds = [...new Set((values.targetSlackUserIds as string[] | undefined) ?? [])];
  const targetEmployeeIds = [...new Set(targetSlackUserIds
    .map((slackUserId) => identityBySlackUser.get(slackUserId))
    .filter((employeeId): employeeId is string => Boolean(employeeId)))];
  if (targetEmployeeIds.length !== 1) {
    return {
      employeeId: null,
      warnings: [targetEmployeeIds.length > 1
        ? "Multiple mapped dock targets found; employee attribution left unassigned"
        : targetSlackUserIds.length
          ? "No mapped dock target found; employee attribution left unassigned"
          : "No dock target mention found; employee attribution left unassigned"],
    };
  }

  return { employeeId: targetEmployeeIds[0], warnings: [] };
}
