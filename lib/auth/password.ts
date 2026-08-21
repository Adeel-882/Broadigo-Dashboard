import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function verifyExecutiveCredentials(email: string, password: string) {
  const expectedEmail = process.env.CEO_EMAIL;
  const stored = process.env.CEO_PASSWORD_HASH;
  if (process.env.NODE_ENV !== "production" && process.env.DEMO_AUTH_BYPASS === "true") {
    return email.toLowerCase() === (expectedEmail ?? "ceo@broadigo.local").toLowerCase() && password === "command-center";
  }
  if (!expectedEmail || !stored || !email || !password || email.toLowerCase() !== expectedEmail.toLowerCase()) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
