import { ApiClientError, authorizedJson } from "./api-client";

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
    public code = "request_failed",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function postJson<T>(path: string, body: object): Promise<T> {
  try {
    return await authorizedJson<T>(`/api/creative${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw new ApiError(error.status, error.message, error.code);
    }
    throw error;
  }
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
