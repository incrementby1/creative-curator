export type SessionStatus = "active" | "refined_ready" | "approved" | "executed";

export type RejectionReason =
  | "too_generic"
  | "too_loud"
  | "not_our_audience"
  | "not_authentic"
  | "other";

export type ToneSlider = {
  label: string;
  left: string;
  right: string;
  value: number;
};

export type BrandDna = {
  beliefs: [string, string, string];
  tone_sliders: [ToneSlider, ToneSlider];
};

export type Direction = {
  id: number;
  name: string;
  tone: string;
  visual_style: string;
  creative_intent: string;
  palette: string[];
  channels: string[];
  why_it_works: string;
};

export type RejectionInput = {
  direction_id: number;
  reason: RejectionReason;
  note: string | null;
};

export type Rejection = RejectionInput;

export type Artifact = {
  caption: string;
  layout_mock_svg: string;
  rationale: [string, string, string];
};

export type CreativeSession = {
  session_id: string;
  brand_name: string;
  description: string;
  goal: string | null;
  reference: string | null;
  dna: BrandDna;
  directions: Direction[];
  round: number;
  status: SessionStatus;
  rejections: Rejection[];
  constraints: string[];
  refined_direction: Direction | null;
  artifact: Artifact | null;
  updated_at: string;
};

export type ExecuteResponse = {
  session_id: string;
  status: "executed";
  artifact: Artifact;
  direction: Direction;
};

export type StartSessionInput = {
  brand_name: string;
  description: string;
  goal: string | null;
  reference: string | null;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function accessToken(): Promise<string> {
  const { getBrowserAuthClient } = await import("./supabase/browser");
  const token = await (await getBrowserAuthClient()).getAccessToken();
  if (!token) throw new ApiError(401, "Sign in to continue.");
  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function postJson<T>(path: string, body: object): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`/api/creative${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  let parsed = true;

  try {
    payload = await response.json();
  } catch {
    parsed = false;
  }

  if (!response.ok) {
    const detail = isRecord(payload) ? payload.detail : undefined;
    const message = Array.isArray(detail)
      ? detail
          .map((item) =>
            typeof item === "object" && item !== null && typeof item.msg === "string"
              ? item.msg
              : "",
          )
          .filter(Boolean)
          .join(" ")
      : typeof detail === "string"
        ? detail
        : "";

    throw new ApiError(response.status, message || "Creative service unavailable.");
  }

  if (!parsed || payload === null) {
    throw new ApiError(response.status, "Creative service returned invalid JSON.");
  }

  return payload as T;
}

export const creativeApi = {
  start: (input: StartSessionInput) => postJson<CreativeSession>("/start", input),
  reject: (sessionId: string, rejections: RejectionInput[]) =>
    postJson<CreativeSession>("/reject", { session_id: sessionId, rejections }),
  approve: (sessionId: string) =>
    postJson<CreativeSession>("/approve", { session_id: sessionId }),
  execute: (sessionId: string) =>
    postJson<ExecuteResponse>("/execute", { session_id: sessionId }),
};
