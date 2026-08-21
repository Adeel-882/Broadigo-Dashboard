import { ingestSlackEvent } from "@/lib/slack/ingest";
import { ingestSlackReactionEvent } from "@/lib/slack/reaction-events";
import { recordSlackEventOutcome } from "@/lib/slack/observability";
import { verifySlackSignature } from "@/lib/slack/signature";
import type { SlackEnvelope, SlackEventCallback, SlackMessageEvent, SlackReactionEvent, SlackReactionEventCallback } from "@/lib/slack/types";
import { classifySlackEnvelope } from "@/lib/slack/event-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Slack delivery endpoint.
 *
 * The database write runs inline and is awaited before responding. It used to be
 * deferred with `after()`, which meant the endpoint answered 200 before the
 * write happened: on Vercel the deferred callback is not guaranteed to run to
 * completion once the response is flushed, so failures were both silent and
 * unrecoverable. Slack allows ~3 seconds, which is ample for a single indexed
 * insert, and every write path is idempotent (unique `event_id`, unique
 * workspace+channel+ts), so a Slack retry can never duplicate a record.
 *
 * On failure we deliberately return 500 so Slack retries the delivery instead of
 * dropping the message permanently.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySlackSignature(rawBody, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"))) {
    console.warn("[slack-event] result=rejected reason=invalid-signature");
    return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  let payload: SlackEnvelope;
  try { payload = JSON.parse(rawBody) as SlackEnvelope; }
  catch {
    console.warn("[slack-event] result=rejected reason=invalid-json");
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const routing = classifySlackEnvelope(payload);
  if (routing.action === "verify") {
    console.log("[slack-event] action=verify result=challenge");
    return new Response(routing.challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }

  const callback = payload as SlackEventCallback;
  const event = callback.event as Partial<SlackMessageEvent> & Partial<SlackReactionEvent>;
  const identity = {
    eventId: callback.event_id ?? null,
    workspaceId: callback.team_id ?? null,
    slackChannelId: event?.channel ?? event?.item?.channel ?? null,
    slackUserId: event?.user ?? null,
    slackTs: event?.ts ?? event?.item?.ts ?? null,
  };

  if (routing.action === "ignore") {
    await recordSlackEventOutcome({ ...identity, routingAction: "ignore", result: "ignored", reason: routing.reason });
    return Response.json({ ok: true, ignored: routing.reason });
  }

  const startedAt = Date.now();
  try {
    const outcome = routing.action === "reaction"
      ? await ingestSlackReactionEvent(payload as unknown as SlackReactionEventCallback)
      : await ingestSlackEvent(callback);
    const status = (outcome as { status: string }).status;
    const reason = (outcome as { reason?: string }).reason ?? null;
    const recordType = (outcome as { recordType?: string }).recordType ?? null;

    await recordSlackEventOutcome({
      ...identity,
      routingAction: routing.action,
      result: status,
      reason,
      recordType,
      workspaceMatched: (outcome as { workspaceMatched?: boolean }).workspaceMatched
        ?? (status === "database-not-configured" ? null : status === "unconfigured-channel" ? null : true),
      channelMatched: (outcome as { channelMatched?: boolean }).channelMatched
        ?? (status === "database-not-configured" ? null : status === "unconfigured-channel" ? false : true),
      durationMs: Date.now() - startedAt,
    });

    // A missing database means the write never happened; make Slack retry it.
    if (status === "database-not-configured") {
      return Response.json({ ok: false, error: "database-not-configured" }, { status: 500 });
    }
    return Response.json({ ok: true, result: status }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion error";
    await recordSlackEventOutcome({
      ...identity,
      routingAction: routing.action,
      result: "error",
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    });
    console.error("[slack-event] ingestion threw", error);
    return Response.json({ ok: false, error: "ingestion-failed" }, { status: 500 });
  }
}
