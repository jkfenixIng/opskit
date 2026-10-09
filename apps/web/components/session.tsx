"use client";

import { useEffect, useState } from "react";
import { useMessages } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { api } from "./api";

export type SessionUser = { id: string; email: string; role: string };
export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ user: SessionUser }>("auth/session")
      .then(({ user: nextUser }) => setUser(nextUser))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  return { user, setUser, loading };
}
export function SignIn({
  onSignedIn,
}: {
  onSignedIn: (user: SessionUser) => void;
}) {
  const t = useMessages();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<{ user: SessionUser }>("auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onSignedIn(result.user);
    } catch (reason) {
      setError(errorMessage(reason, t.auth.signInFailed));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="sign-in">
      <section>
        <p className="eyebrow">{t.meta.title}</p>
        <h1>{t.auth.headline}</h1>
        <p>{t.auth.prompt}</p>
        <form onSubmit={submit}>
          <label htmlFor="login-email">{t.auth.email}</label>
          <input
            id="login-email"
            name="email"
            autoComplete="email"
            spellCheck={false}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="login-password">{t.auth.password}</label>
          <input
            id="login-password"
            name="current-password"
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={submitting}>
            {submitting ? t.auth.signingIn : t.auth.signIn}
          </button>
        </form>
      </section>
    </main>
  );
}
