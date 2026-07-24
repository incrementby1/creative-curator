export const TEST_AUTH_COOKIE = "creative-curator-test-auth";
export const TEST_AUTH_SCENARIO_COOKIE = "creative-curator-test-auth-scenario";
export const TEST_AUTH_PASSWORD = "correct-horse-1";

export type AuthUser = { id: string; email: string | null };
export type AuthState = { user: AuthUser | null; accessToken: string | null };
export type AuthResult = { error: string | null };
export type AuthSubscription = { unsubscribe: () => void };

export interface AuthClient {
  signUp(email: string, password: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
  getAccessToken(): Promise<string | null>;
  subscribe(listener: (state: AuthState) => void): AuthSubscription;
}

export function isTestAuthMode(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_MODE === "test" && process.env.NODE_ENV !== "production";
}

export function safeNextPath(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) return "/";
  return value;
}
