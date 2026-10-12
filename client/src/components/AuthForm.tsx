import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api";
import type { User } from "../types";

export function AuthForm({ onAuth }: { onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAuth(mode === "login" ? await api.login({ email, password }) : await api.register({ email, name, password }));
    } catch (err) {
      const d = err instanceof ApiError && err.details ? Object.entries(err.details).map(([k, v]) => `${k}: ${v[0]}`).join("; ") : null;
      setError(d ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth" onSubmit={submit}>
        <h1>boardly</h1>
        <p className="muted">Real-time kanban for small teams.</p>
        {mode === "register" && (
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        )}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
        {error && <p className="err">{error}</p>}
        <button type="submit" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"}</button>
        <button type="button" className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
