import { and, desc, eq, ne } from "drizzle-orm";
import { classifyAppointmentQualification } from "@/lib/appointment-qualification";
import { getDb } from "@/lib/db/client";
import { appointmentDispositions, appointments, slackChannels, slackEvents, slackMessages } from "@/lib/db/schema";
import { normalizeSlackThreadReplyEvent } from "@/lib/slack/message-eligibility";
import type { SlackEventCallback, SlackMessageEvent } from "@/lib/slack/types";

const QUALIFICATION_CHANNELS = new Set(["C098WNHNBR7", "C0B0P6P7FPG"]);

export async function ingestAppointmentDispositionEvent(payload: SlackEventCallback) {
  const db = getDb("ingestion");
  if (!db) return { status: "database-not-configured" as const };
  const reply = normalizeSlackThreadReplyEvent(payload.event as SlackMessageEvent);
  if (!reply) return { status: "ignored" as const, reason: "not-a-thread-reply" };
  if (!QUALIFICATION_CHANNELS.has(reply.channel)) return { status: "ignored" as const, reason: "not-a-qualification-channel" };

  return db.transaction(async (tx) => {
    const [channel] = await tx.select().from(slackChannels).where(and(
      eq(slackChannels.workspaceId, payload.team_id),
      eq(slackChannels.slackChannelId, reply.channel),
      eq(slackChannels.active, true),
    )).limit(1);
    if (!channel) return { status: "unconfigured-channel" as const };

    const [parent] = await tx.select({ appointment: appointments }).from(slackMessages)
      .innerJoin(appointments, eq(appointments.slackMessageId, slackMessages.id))
      .where(and(
        eq(slackMessages.workspaceId, payload.team_id),
        eq(slackMessages.channelId, channel.id),
        eq(slackMessages.slackTs, reply.thread_ts!),
      )).limit(1);
    if (!parent) return { status: "ignored" as const, reason: "unknown-appointment-parent" };
    if (!reply.user || parent.appointment.assignedPerson !== reply.user) {
      return { status: "ignored" as const, reason: "not-assigned-closer" };
    }

    const claimed = await tx.insert(slackEvents).values({ eventId: payload.event_id, workspaceId: payload.team_id })
      .onConflictDoNothing().returning({ id: slackEvents.id });
    if (!claimed.length) return { status: "duplicate" as const };

    const status = classifyAppointmentQualification(reply.text!);
    await tx.insert(appointmentDispositions).values({
      appointmentId: parent.appointment.id,
      slackReplyTs: reply.ts,
      evaluatorSlackUserId: reply.user,
      status,
    }).onConflictDoUpdate({
      target: [appointmentDispositions.appointmentId, appointmentDispositions.slackReplyTs],
      set: { status, evaluatorSlackUserId: reply.user, updatedAt: new Date() },
    });

    const [latest] = await tx.select().from(appointmentDispositions).where(and(
      eq(appointmentDispositions.appointmentId, parent.appointment.id),
      eq(appointmentDispositions.evaluatorSlackUserId, reply.user),
      ne(appointmentDispositions.status, "UNKNOWN"),
    )).orderBy(desc(appointmentDispositions.slackReplyTs)).limit(1);

    await tx.update(appointments).set({
      qualificationStatus: latest?.status ?? "UNKNOWN",
      qualifiedAt: latest?.status === "QUALIFIED" ? new Date(Number.parseFloat(latest.slackReplyTs) * 1000) : null,
      qualificationSourceTs: latest?.slackReplyTs ?? null,
      qualificationEvaluatorSlackUserId: latest?.evaluatorSlackUserId ?? null,
    }).where(eq(appointments.id, parent.appointment.id));

    return { status: "applied" as const, qualificationStatus: latest?.status ?? "UNKNOWN", appointmentUpdated: true };
  });
}
