import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { verifySlackSignature } from "@/lib/slack/signature";

const originalSecret = process.env.SLACK_SIGNING_SECRET;
afterEach(() => { process.env.SLACK_SIGNING_SECRET = originalSecret; });

describe("Slack request verification", () => {
  it("accepts a correctly signed current request", () => {
    process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const signature = `v0=${createHmac("sha256", process.env.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest("hex")}`;
    expect(verifySlackSignature(body, timestamp, signature)).toBe(true);
  });

  it("rejects stale and tampered requests", () => {
    process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
    const stale = String(Math.floor(Date.now() / 1000) - 601);
    expect(verifySlackSignature("{}", stale, "v0=invalid")).toBe(false);
    expect(verifySlackSignature("{}", String(Math.floor(Date.now() / 1000)), "v0=invalid")).toBe(false);
  });
});
