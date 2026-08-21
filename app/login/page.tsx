import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return <main className="login-page">
    <div className="login-aurora" />
    <section className="login-panel">
      <div className="brand-mark brand-mark-large">B</div>
      <p className="eyebrow">Broadigo Intelligence</p>
      <h1>Your company,<br /><span>in one view.</span></h1>
      <p className="login-copy">Secure, Slack-backed employee performance intelligence for executive decision-making.</p>
      <LoginForm />
    </section>
    <aside className="login-visual" aria-hidden="true">
      <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-node node-one" /><div className="orbit-node node-two" /><div className="orbit-node node-three" />
      <div className="login-stat"><span>Live operating signal</span><strong>3 divisions</strong><em>• Synchronized</em></div>
    </aside>
  </main>;
}
