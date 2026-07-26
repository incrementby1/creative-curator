import type { AuthClient } from "./auth";

type FastApiIssue = { loc?: unknown; msg?: unknown };

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly category?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readableError(status: number, payload: unknown): ApiClientError {
  if (status === 404) {
    return new ApiClientError(status, "project_not_found", "Project was not found or is unavailable.");
  }
  const detail = isRecord(payload) ? payload.detail : undefined;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: FastApiIssue) => (typeof item.msg === "string" ? item.msg : ""))
      .filter(Boolean);
    return new ApiClientError(status, "invalid_request", messages.join(" ") || "Check the highlighted values.");
  }
  if (isRecord(detail)) {
    const code = typeof detail.code === "string" ? detail.code : "request_failed";
    const category = typeof detail.category === "string" ? detail.category : undefined;
    return new ApiClientError(status, code, errorMessage(code, category), category);
  }
  return new ApiClientError(
    status,
    "request_failed",
    "Service is unavailable. Try again.",
  );
}

function errorMessage(code: string, category?: string): string {
  if (code === "ai_configuration_required") {
    return "Connect a provider and save routing before generating.";
  }
  if (code === "all_providers_failed") {
    return "Configured AI providers are unavailable. Check Settings and try again.";
  }
  if (code === "provider_connection_failed") {
    return category === "auth"
      ? "Provider rejected this key. Check it and test again."
      : "Provider connection failed. Check the model and endpoint, then try again.";
  }
  if (code === "provider_in_use") return "Remove this provider from routing before disconnecting it.";
  if (code === "provider_not_connected") return "Connect every selected provider before saving routing.";
  if (code === "settings_version_conflict") return "Settings changed elsewhere.";
  if (code === "version_conflict") return "Project changed elsewhere. Reload and compare before retrying.";
  if (code === "project_store_unavailable") return "Project service is unavailable. Your work is unchanged; try again.";
  if (code === "media_in_use") return "Remove this media from the canvas before deleting it.";
  if (code === "media_too_large") return "Media must be no larger than 5 MiB.";
  if (code === "invalid_media_type") return "Use a PNG, JPEG, or WebP image.";
  if (code === "invalid_project_request") return "Check the project values and try again.";
  if (code === "invalid_provider_configuration") return "Check the model and endpoint, then try again.";
  return "Request could not be completed. Check the values and try again.";
}

function sendToLogin(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export async function authorizedResponse(
  path: string,
  init: RequestInit = {},
  suppliedClient?: AuthClient,
): Promise<Response> {
  const client = suppliedClient ?? await (await import("./supabase/browser")).getBrowserAuthClient();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await client.getAccessToken();
    if (!token) {
      sendToLogin();
      throw new ApiClientError(401, "authentication_required", "Sign in to continue.");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetch(path, { ...init, headers });
    } catch {
      throw new ApiClientError(0, "service_unavailable", "Service is unavailable. Try again.");
    }
    if (response.status === 401 && attempt === 0) continue;
    if (response.status === 401) {
      sendToLogin();
      throw new ApiClientError(401, "authentication_required", "Sign in to continue.");
    }
    if (response.ok) return response;
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) throw new ApiClientError(response.status, "invalid_response", "Service returned an invalid response.");
    }
    throw readableError(response.status, payload);
  }
  throw new ApiClientError(401, "authentication_required", "Sign in to continue.");
}

export async function authorizedJson<T>(
  path: string,
  init: RequestInit = {},
  suppliedClient?: AuthClient,
): Promise<T> {
  const response = await authorizedResponse(path, init, suppliedClient);
  if (response.status === 204) return undefined as T;
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(response.status, "invalid_response", "Service returned an invalid response.");
  }
  if (payload === null) throw new ApiClientError(response.status, "invalid_response", "Service returned an invalid response.");
  return payload as T;
}
