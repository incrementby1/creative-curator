"use client";

import { useRef, useState } from "react";
import { safeNextPath } from "../../lib/auth";
import { useAuth } from "./auth-provider";
import styles from "./auth.module.css";

type Mode = "sign-in" | "sign-up";

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function AuthForm() {
  const { authError, clearAuthError, client } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  function validateEmail(): boolean {
    const error = validEmail(email) ? "" : "Enter a valid email address.";
    setEmailError(error);
    return !error;
  }

  function validatePassword(): boolean {
    const error = password.length >= 8 ? "" : "Password must be at least 8 characters.";
    setPasswordError(error);
    return !error;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearAuthError();
    setFormError("");
    const emailValid = validateEmail();
    const passwordValid = validatePassword();
    if (!emailValid || !passwordValid || !client) return;
    setPending(true);
    let result;
    try {
      result = mode === "sign-in"
        ? await client.signIn(email.trim(), password)
        : await client.signUp(email.trim(), password);
    } catch {
      result = { error: "Authentication service unavailable." };
    } finally {
      setPending(false);
    }
    if (result.error) {
      setFormError(result.error);
      setPassword("");
      requestAnimationFrame(() => passwordRef.current?.focus());
      return;
    }
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    window.location.assign(next);
  }

  function switchMode() {
    setMode((current) => current === "sign-in" ? "sign-up" : "sign-in");
    setPassword("");
    setPasswordError("");
    setFormError("");
  }

  return (
    <main className={styles.page}>
      <section className={styles.workbench} aria-labelledby="auth-title">
        <div className={styles.identity}>
          <span>Creative Curator</span>
          <p>A quiet workspace for clear creative decisions.</p>
        </div>
        <div className={styles.formArea}>
          <p className={styles.kicker}>Account access</p>
          <h1 id="auth-title">{mode === "sign-in" ? "Sign in" : "Create account"}</h1>
          <p className={styles.intro}>
            {mode === "sign-in"
              ? "Continue to your creative workspace."
              : "Set up your workspace with email and password."}
          </p>
          <form noValidate onSubmit={submit}>
            <div className={styles.field}>
              <label htmlFor="auth-email">Email</label>
              <input
                aria-describedby={emailError ? "email-error" : undefined}
                aria-invalid={Boolean(emailError)}
                autoComplete="email"
                id="auth-email"
                onBlur={validateEmail}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
              {emailError && <p className={styles.fieldError} id="email-error">{emailError}</p>}
            </div>
            <div className={styles.field}>
              <label htmlFor="auth-password">Password</label>
              <div className={styles.passwordControl}>
                <input
                  aria-describedby={passwordError ? "password-error" : undefined}
                  aria-invalid={Boolean(passwordError)}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  id="auth-password"
                  onBlur={validatePassword}
                  onChange={(event) => setPassword(event.target.value)}
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((current) => !current)}
                  type="button"
                >
                  {showPassword ? "Hide password" : "Show password"}
                </button>
              </div>
              {passwordError && <p className={styles.fieldError} id="password-error">{passwordError}</p>}
            </div>
            {(formError || authError) && (
              <p className={styles.formError} role="alert">{formError || authError}</p>
            )}
            <button className={styles.submit} disabled={pending || !client} type="submit">
              {pending ? (mode === "sign-in" ? "Signing in…" : "Creating account…") : (mode === "sign-in" ? "Sign in" : "Create account")}
            </button>
          </form>
          <p className={styles.switcher}>
            {mode === "sign-in" ? "New to Creative Curator?" : "Already have an account?"}
            <button onClick={switchMode} type="button">
              {mode === "sign-in" ? "Create an account" : "Sign in instead"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
