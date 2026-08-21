"use client";

import { useActionState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return <form action={action} className="login-form">
    <label>Executive email<input name="email" type="email" autoComplete="username" placeholder="ceo@company.com" required /></label>
    <label>Access key<input name="password" type="password" autoComplete="current-password" placeholder="••••••••••••" required /></label>
    {state?.error && <p className="form-error" role="alert">{state.error}</p>}
    <button className="primary-button" disabled={pending}>{pending ? "Verifying…" : <>Enter command center <ArrowRight size={17} /></>}</button>
    <p className="login-security"><LockKeyhole size={13} /> Encrypted executive access · 12-hour session</p>
  </form>;
}
