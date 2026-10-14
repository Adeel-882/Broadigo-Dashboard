export function dockAuthorLabel(employeeName?: string | null, pseudoName?: string | null, slackDisplayName?: string | null) {
  if (employeeName && pseudoName && employeeName.toLowerCase() !== pseudoName.toLowerCase()) return `${employeeName} / ${pseudoName}`;
  return slackDisplayName?.trim() || employeeName?.trim() || null;
}
