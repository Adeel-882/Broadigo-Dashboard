import "server-only";

import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/**
 * TEMPORARY fixed administrator credential.
 *
 * Credential verification is intentionally pinned to the constants below
 * instead of the CEO_EMAIL / CEO_PASSWORD_HASH environment variables, which
 * were failing to authenticate in the deployed environment.
 *
 * The password itself is never stored here — only a scrypt hash in the same
 * `saltHex:hashHex` format that `scripts/hash-password.mjs` produces, verified
 * by the same routine as before. `import "server-only"` guarantees this module
 * can never be pulled into a client bundle, so the hash is not reachable from
 * the browser.
 *
 * To rotate: run `pnpm auth:hash -- "<new password>"` and replace
 * ADMIN_PASSWORD_HASH with its output. To restore environment-driven
 * credentials, read the two variables again in verifyExecutiveCredentials.
 */
const ADMIN_EMAIL = "ceo@broadigo.com";
const ADMIN_PASSWORD_HASH =
  "f93a435581bfbf55c621acd505a6b926:2d6badd9cfa6458e786aeb2bb67f1374a2832438824cac54570c25d038bd476489d0c1ff75964b82966132d028f0521d6610cd37326d29db0100eaae75059825";

/** The address the fixed administrator account signs in with. */
export const executiveEmail = ADMIN_EMAIL;

const sameEmail = (candidate: string, expected: string) =>
  candidate.trim().toLowerCase() === expected.trim().toLowerCase();

export async function verifyExecutiveCredentials(email: string, password: string) {
  if (!email || !password) return false;

  // Local-only convenience path; NODE_ENV pins it out of the deployed app.
  if (process.env.NODE_ENV !== "production" && process.env.DEMO_AUTH_BYPASS === "true") {
    return sameEmail(email, ADMIN_EMAIL) && password === "command-center";
  }

  if (!sameEmail(email, ADMIN_EMAIL)) return false;

  const [saltHex, hashHex] = ADMIN_PASSWORD_HASH.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
