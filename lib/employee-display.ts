/** Presentation only: preserve all identity aliases for attribution and search. */
export function displayEmployeeAliases(employee: { name: string; pseudoName?: string; aliases?: string[] }) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const name = normalize(employee.name);
  const pseudo = employee.pseudoName?.trim();
  const redundant = new Set([name, ...(pseudo ? [normalize(`${employee.name} (${pseudo})`)] : [])]);
  const seen = new Set<string>();
  return [pseudo, ...(employee.aliases ?? [])].filter((value): value is string => {
    if (!value?.trim()) return false;
    const key = normalize(value);
    if (redundant.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(value => value.trim());
}
