"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { verifyExecutiveCredentials } from "@/lib/auth/password";

export async function login(_: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!(await verifyExecutiveCredentials(email, password))) return { error: "The email or access key is incorrect." };

  // Session creation is the other way login can fail: createSession throws when
  // SESSION_SECRET is missing or shorter than 32 characters in production.
  // Reporting that separately keeps a misconfigured secret from looking like a
  // rejected password. redirect() throws NEXT_REDIRECT by design, so it stays
  // outside the try block.
  try {
    const token = await createSession(email);
    (await cookies()).set(sessionCookie.name, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: sessionCookie.maxAge,
    });
  } catch {
    return { error: "Sign-in is unavailable: SESSION_SECRET is missing or shorter than 32 characters." };
  }

  redirect("/");
}
