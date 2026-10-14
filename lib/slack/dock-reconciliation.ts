export function slackSourceDate(slackTs: string) {
  const [seconds, fraction = ""] = slackTs.split(".");
  const milliseconds = Number.parseInt(fraction.padEnd(3, "0").slice(0, 3), 10) || 0;
  return new Date(Number.parseInt(seconds, 10) * 1000 + milliseconds);
}

export function dockRecipientPlan(currentIds: string[], expectedIds: string[]) {
  const current = [...new Set(currentIds)].sort();
  const expected = [...new Set(expectedIds)].sort();
  const currentSet = new Set(current);
  const expectedSet = new Set(expected);

  return {
    keep: current.filter((id) => expectedSet.has(id)),
    insert: expected.filter((id) => !currentSet.has(id)),
    remove: current.filter((id) => !expectedSet.has(id)),
    final: expected,
  };
}
