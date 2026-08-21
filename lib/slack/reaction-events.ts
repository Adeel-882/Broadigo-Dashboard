import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { leads, slackChannels, slackEvents, slackMessages } from "@/lib/db/schema";
import { applyReactionEvent, deriveLeadEligibility, isExcludingReaction } from "@/lib/slack/reactions";
import type { SlackReactionEvent, SlackReactionEventCallback } from "@/lib/slack/types";

/**
 * Applies a live `reaction_added` / `reaction_removed` event to lead KPI eligibility.
 *
 * Only reactions on top-level messages in a configured leads channel matter, and
 * only `x` and `arrow_left` change anything. No other KPI is touched: the handler
 * writes to `slack_messages.reactions` and the derived columns on `leads` alone.
 */
export async function ingestSlackReactionEvent(payload: SlackReactionEventCallback) {
  const db = getDb("ingestion");
  if (!db) return { status: "database-not-configured" as const };
  const event = payload.event as SlackReactionEvent;
  if (event.item?.type !== "message") return { status: "ignored" as const, reason: "item-type" };
  if (!isExcludingReaction(event.reaction)) return { status: "ignored" as const, reason: "reaction-not-relevant" };

  return db.transaction(async (tx) => {
    const [channel] = await tx.select().from(slackChannels)
      .where(and(
        eq(slackChannels.workspaceId, payload.team_id),
        eq(slackChannels.slackChannelId, event.item.channel),
        eq(slackChannels.active, true),
      )).limit(1);
    if (!channel) return { status: "unconfigured-channel" as const };
    if (channel.parserType !== "leads") return { status: "ignored" as const, reason: "not-a-leads-channel" };

    // Claim the event id so a Slack retry cannot double-apply the count change.
    const claimed = await tx.insert(slackEvents)
      .values({ eventId: payload.event_id, workspaceId: payload.team_id })
      .onConflictDoNothing().returning({ id: slackEvents.id });
    if (!claimed.length) return { status: "duplicate" as const };

    const [message] = await tx.select().from(slackMessages)
      .where(and(
        eq(slackMessages.workspaceId, payload.team_id),
        eq(slackMessages.channelId, channel.id),
        eq(slackMessages.slackTs, event.item.ts),
      )).limit(1);
    if (!message) return { status: "unknown-message" as const };

    const reactions = applyReactionEvent(message.reactions, { type: event.type, reaction: event.reaction, user: event.user });
    await tx.update(slackMessages).set({ reactions, reactionsSyncedAt: new Date() }).where(eq(slackMessages.id, message.id));

    const eligibility = deriveLeadEligibility(reactions);
    const updated = await tx.update(leads)
      .set({ countsTowardKpi: eligibility.countsTowardKpi, exclusionReasons: eligibility.exclusionReasons })
      .where(eq(leads.slackMessageId, message.id))
      .returning({ id: leads.id });

    return {
      status: "applied" as const,
      leadUpdated: updated.length > 0,
      countsTowardKpi: eligibility.countsTowardKpi,
      exclusionReasons: eligibility.exclusionReasons,
    };
  });
}
