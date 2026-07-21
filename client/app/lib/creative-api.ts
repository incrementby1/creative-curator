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

async function postJson<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`/api/creative${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    detail?: unknown;
  } | null;

  if (!response.ok) {
    const detail = Array.isArray(payload?.detail)
      ? payload.detail
          .map((item) =>
            typeof item === "object" && item !== null && typeof item.msg === "string"
              ? item.msg
              : "",
          )
          .filter(Boolean)
          .join(" ")
      : typeof payload?.detail === "string"
        ? payload.detail
        : "";

    throw new ApiError(response.status, detail || "Creative service unavailable.");
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
