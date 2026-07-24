"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthClient, AuthState, AuthUser } from "../../lib/auth";
import { getBrowserAuthClient } from "../../lib/supabase/browser";

type AuthContextValue = {
  client: AuthClient | null;
  user: AuthUser | null;
  ready: boolean;
  authError: string;
  clearAuthError: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export type AuthClientFactory = () => Promise<AuthClient>;
export type AuthNavigate = (path: string) => void;

const defaultNavigate: AuthNavigate = (path) => window.location.assign(path);

export function AuthProvider({
  children,
  clientFactory = getBrowserAuthClient,
  navigate = defaultNavigate,
}: {
  children: ReactNode;
  clientFactory?: AuthClientFactory;
  navigate?: AuthNavigate;
}) {
  const [client, setClient] = useState<AuthClient | null>(null);
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null });
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void clientFactory()
      .then((nextClient) => {
        if (!active) return;
        setClient(nextClient);
        const subscription = nextClient.subscribe((nextState) => {
          if (!active) return;
          setState(nextState);
          setReady(true);
        });
        unsubscribe = subscription.unsubscribe;
      })
      .catch(() => {
        if (!active) return;
        setAuthError("Authentication is unavailable. Check the local configuration and try again.");
        setReady(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [clientFactory]);

  const signOut = useCallback(async () => {
    if (!client) return;
    setAuthError("");
    try {
      const result = await client.signOut();
      if (result.error) {
        setAuthError(`${result.error} Try again.`);
        return;
      }
      navigate("/login");
    } catch {
      setAuthError("Unable to sign out. Check your connection and try again.");
    }
  }, [client, navigate]);

  const clearAuthError = useCallback(() => setAuthError(""), []);

  const value = useMemo(
    () => ({ client, user: state.user, ready, authError, clearAuthError, signOut }),
    [authError, clearAuthError, client, ready, signOut, state.user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
