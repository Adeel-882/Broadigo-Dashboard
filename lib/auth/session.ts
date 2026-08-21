const COOKIE_NAME = "broadigo_exec_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function base64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || (process.env.NODE_ENV === "production" && secret.length < 32)) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

export async function createSession(email: string) {
  const payload = base64Url(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }));
  const signature = await hmac(payload);
  if (!signature) throw new Error("SESSION_SECRET is not configured securely.");
  return `${payload}.${signature}`;
}

export async function verifySession(token?: string | null) {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = await hmac(payload);
  if (!expected || expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  if (mismatch !== 0) return false;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(atob(normalized)) as { exp: number };
    return data.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export const sessionCookie = { name: COOKIE_NAME, maxAge: SESSION_TTL_SECONDS };

export async function isAuthenticatedRequest(request: Request) {
  if (process.env.NODE_ENV !== "production" && process.env.DEMO_AUTH_BYPASS === "true") return true;
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return verifySession(cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : null);
}
