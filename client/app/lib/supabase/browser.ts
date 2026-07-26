"use client";

import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { AuthClient, AuthState } from "../auth";
import {
  isTestAuthMode,
  TEST_AUTH_COOKIE,
  TEST_AUTH_PASSWORD,
  TEST_AUTH_SCENARIO_COOKIE,
} from "../auth";

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const item = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}

function stableUserId(email: string): string {
  let hash = 2166136261;
  for (const character of email.trim().toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `test-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function testState(): AuthState {
  const accessToken = readCookie(TEST_AUTH_COOKIE);
  if (!accessToken?.startsWith("test-user:") || accessToken.length <= "test-user:".length) {
    return { user: null, accessToken: null };
  }
  return {
    user: { id: accessToken.slice("test-user:".length), email: null },
    accessToken,
  };
}

function createTestAuthClient(): AuthClient {
  const listeners = new Set<(state: AuthState) => void>();
  const publish = () => {
    const state = testState();
    listeners.forEach((listener) => listener(state));
  };
  const authenticate = async (email: string, password: string) => {
    if (password !== TEST_AUTH_PASSWORD) return { error: "Email or password is incorrect." };
    const token = `test-user:${stableUserId(email)}`;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${TEST_AUTH_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=86400${secure}`;
    publish();
    return { error: null };
  };

  return {
    signUp: authenticate,
    signIn: authenticate,
    async signOut() {
      const scenario = readCookie(TEST_AUTH_SCENARIO_COOKIE);
      if (scenario === "signout-error") return { error: "Unable to sign out." };
      if (scenario === "signout-throw") throw new Error("Test sign-out failure");
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${TEST_AUTH_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure}`;
      publish();
      return { error: null };
    },
    async getAccessToken() {
      return testState().accessToken;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (readCookie(TEST_AUTH_SCENARIO_COOKIE) === "auth-delay") {
        window.setTimeout(() => listener(testState()), 200);
      } else queueMicrotask(() => listener(testState()));
      return { unsubscribe: () => listeners.delete(listener) };
    },
  };
}

function stateFromSession(session: Session | null): AuthState {
  return {
    user: session?.user
      ? { id: session.user.id, email: session.user.email ?? null }
      : null,
    accessToken: session?.access_token ?? null,
  };
}

async function createProductionAuthClient(): Promise<AuthClient> {
  const { createBrowserClient } = await import("@supabase/ssr");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase browser auth is not configured.");
  const supabase = createBrowserClient(url, key);

  return {
    async signUp(email, password) {
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error ? "Unable to create account." : null };
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? "Email or password is incorrect." : null };
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      return { error: error ? "Unable to sign out." : null };
    },
    async getAccessToken() {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    subscribe(listener) {
      const { data } = supabase.auth.onAuthStateChange(
        (_event: AuthChangeEvent, session: Session | null) => listener(stateFromSession(session)),
      );
      return { unsubscribe: () => data.subscription.unsubscribe() };
    },
  };
}

let authClientPromise: Promise<AuthClient> | null = null;

export function getBrowserAuthClient(): Promise<AuthClient> {
  if (isTestAuthMode() && readCookie(TEST_AUTH_SCENARIO_COOKIE) === "init-error") {
    return Promise.reject(new Error("Test auth initialization failure"));
  }
  authClientPromise ??= isTestAuthMode()
    ? Promise.resolve(createTestAuthClient())
    : createProductionAuthClient();
  return authClientPromise;
}
