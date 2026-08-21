/**
 * Lead KPI eligibility derived from Slack reactions.
 *
 * Management rule: a structured lead in #leads-reporting counts toward ISA /
 * Lead Management production unless the originating Slack message currently
 * carries an `:x:` or `:arrow_left:` reaction. Every other reaction is
 * irrelevant. Excluded leads are never deleted — the raw message, the
 * structured lead, attribution and prospect details are all preserved, and the
 * exclusion is recorded as a derived status so "submitted" and "counted" stay
 * distinguishable.
 */

export interface SlackReaction {
  name: string;
  count?: number;
  users?: string[];
}

export type LeadExclusionReason = "X_REACTION" | "ARROW_LEFT_REACTION";

export interface LeadEligibility {
  countsTowardKpi: boolean;
  exclusionReasons: LeadExclusionReason[];
}

/** Slack reaction name -> exclusion reason. Matched on the exact API name, never on rendered emoji. */
const EXCLUDING_REACTIONS: ReadonlyMap<string, LeadExclusionReason> = new Map([
  ["x", "X_REACTION"],
  ["arrow_left", "ARROW_LEFT_REACTION"],
]);

export const EXCLUDING_REACTION_NAMES = [...EXCLUDING_REACTIONS.keys()];

/** Slack appends `::skin-tone-N` to some reaction names; the base name is what identifies the emoji. */
export function baseReactionName(name: string) {
  return name.split("::")[0].trim().toLowerCase();
}

export function isExcludingReaction(name: string) {
  return EXCLUDING_REACTIONS.has(baseReactionName(name));
}

/**
 * A reaction excludes the lead when it is present with a positive count. Slack
 * omits `count` on some payloads, so a listed reaction with no count is treated
 * as present rather than silently ignored.
 */
export function deriveLeadEligibility(reactions: SlackReaction[] | null | undefined): LeadEligibility {
  const reasons = new Set<LeadExclusionReason>();
  for (const reaction of reactions ?? []) {
    if (!reaction?.name) continue;
    const count = reaction.count ?? reaction.users?.length ?? 1;
    if (count <= 0) continue;
    const reason = EXCLUDING_REACTIONS.get(baseReactionName(reaction.name));
    if (reason) reasons.add(reason);
  }
  const exclusionReasons = [...EXCLUDING_REACTIONS.values()].filter((reason) => reasons.has(reason));
  return { countsTowardKpi: exclusionReasons.length === 0, exclusionReasons };
}

/**
 * Order-independent fingerprint of a reactions array.
 *
 * Postgres `jsonb` does not preserve object key order, so a stored array never
 * compares equal to the Slack payload as a raw JSON string. Comparing
 * fingerprints instead is what keeps reaction syncing genuinely idempotent.
 */
export function reactionsFingerprint(reactions: SlackReaction[] | null | undefined) {
  return (reactions ?? [])
    .map((reaction) => {
      const users = [...(reaction.users ?? [])].sort().join(",");
      return `${baseReactionName(reaction.name)}:${reaction.count ?? reaction.users?.length ?? 0}:${users}`;
    })
    .sort()
    .join("|");
}

/** Applies a `reaction_added` / `reaction_removed` event to a stored reactions array. */
export function applyReactionEvent(
  stored: SlackReaction[] | null | undefined,
  event: { type: "reaction_added" | "reaction_removed"; reaction: string; user?: string },
): SlackReaction[] {
  const name = baseReactionName(event.reaction);
  const reactions = (stored ?? []).map((reaction) => ({ ...reaction, users: [...(reaction.users ?? [])] }));
  const index = reactions.findIndex((reaction) => baseReactionName(reaction.name) === name);

  if (event.type === "reaction_added") {
    if (index === -1) return [...reactions, { name, count: 1, users: event.user ? [event.user] : [] }];
    const existing = reactions[index];
    if (event.user && existing.users?.includes(event.user)) return reactions;
    existing.users = event.user ? [...(existing.users ?? []), event.user] : existing.users;
    existing.count = (existing.count ?? 0) + 1;
    return reactions;
  }

  if (index === -1) return reactions;
  const existing = reactions[index];
  if (event.user && existing.users?.length && !existing.users.includes(event.user)) return reactions;
  existing.users = existing.users?.filter((user) => user !== event.user);
  existing.count = (existing.count ?? 1) - 1;
  return existing.count > 0 ? reactions : reactions.filter((_, position) => position !== index);
}

export const leadExclusionLabel = (reasons: LeadExclusionReason[]) =>
  reasons.includes("ARROW_LEFT_REACTION") && reasons.includes("X_REACTION") ? "Excluded — rejected and returned"
    : reasons.includes("ARROW_LEFT_REACTION") ? "Excluded — returned"
      : reasons.includes("X_REACTION") ? "Excluded — rejected"
        : "Counted";
