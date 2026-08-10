"use client";

import { FormEvent, useState } from "react";
import styles from "./access.module.css";

export function AuthGate({ mode, nextPath }: { mode: "invite" | "admin"; nextPath: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode === "admin" ? "admin" : "invite"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Access was not granted.");
      window.location.assign(nextPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access was not granted.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={busy}>
      <label htmlFor={`${mode}-code`}>{mode === "admin" ? "Administrator code" : "Private beta invite"}</label>
      <div className={styles.fieldRow}>
        <input
          id={`${mode}-code`}
          name="code"
          type="password"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Enter access code"
          aria-describedby={error ? `${mode}-error` : undefined}
          aria-invalid={Boolean(error)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || code.length < 8}>
          {busy ? "Checking…" : mode === "admin" ? "Open console" : "Enter terminal"}
        </button>
      </div>
      {error ? <p className={styles.error} id={`${mode}-error`} role="alert">{error}</p> : null}
    </form>
  );
}
