import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` is aliased by Next at build time and has no Node resolution.
vi.mock("server-only", () => ({}));

const { executiveEmail, verifyExecutiveCredentials } = await import("@/lib/auth/password");

// The fixed administrator password lives only in the operator's hands. The test
// reads it from an out-of-repo file (TEST_ADMIN_PASSWORD_FILE) or the
// environment, so the plaintext is never committed. Without it, the
// positive-path assertions are skipped and the negative ones still run.
const PASSWORD = (() => {
  const file = process.env.TEST_ADMIN_PASSWORD_FILE;
  if (file) {
    try { return readFileSync(file, "utf8").trim(); } catch { return undefined; }
  }
  return process.env.TEST_ADMIN_PASSWORD;
})();

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DEMO_AUTH_BYPASS", "");
});

describe("fixed administrator credentials", () => {
  it("exposes a single fixed administrator email", () => {
    expect(executiveEmail).toBe("ceo@broadigo.com");
  });

  it("no longer depends on CEO_EMAIL or CEO_PASSWORD_HASH", async () => {
    vi.stubEnv("CEO_EMAIL", "someone-else@example.com");
    vi.stubEnv("CEO_PASSWORD_HASH", "deadbeef:deadbeef");
    // A wrong password still fails, and the tampered env cannot grant access.
    expect(await verifyExecutiveCredentials("someone-else@example.com", "anything")).toBe(false);
    expect(await verifyExecutiveCredentials(executiveEmail, "anything")).toBe(false);
  });

  it.each([
    ["", ""],
    [" ", " "],
    ["ceo@broadigo.com", ""],
    ["", "whatever"],
    ["wrong@broadigo.com", "whatever"],
    ["ceo@broadigo.com", "wrong-password"],
    ["ceo@broadigo.com", "command-center"],
  ])("rejects bad credentials: %s / %s", async (email, password) => {
    expect(await verifyExecutiveCredentials(email, password)).toBe(false);
  });

  it.runIf(PASSWORD)("accepts the fixed administrator credential", async () => {
    expect(await verifyExecutiveCredentials(executiveEmail, PASSWORD!)).toBe(true);
  });

  it.runIf(PASSWORD)("matches the email case-insensitively and ignores surrounding space", async () => {
    expect(await verifyExecutiveCredentials("  CEO@Broadigo.COM  ", PASSWORD!)).toBe(true);
  });

  it.runIf(PASSWORD)("still rejects a correct password on a different email", async () => {
    expect(await verifyExecutiveCredentials("other@broadigo.com", PASSWORD!)).toBe(false);
  });
});
