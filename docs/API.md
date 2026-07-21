# API contract

The Next.js client proxies `/api/creative/*` to FastAPI `/creative/*`. All API payloads are JSON. The four POST routes below are the creative workflow contract.

## Shared response shapes

`CreativeSession` returned by `/start`, `/reject`, and `/approve`:

```json
{
  "session_id": "uuid",
  "brand_name": "Northstar Coffee",
  "description": "A premium coffee brand for busy city mornings.",
  "goal": "Get more menu photo clicks from Google Maps",
  "reference": "Warm but confident; not meme-y",
  "dna": {
    "beliefs": ["...", "...", "..."],
    "tone_sliders": [
      {"label": "Energy", "left": "Calm", "right": "Bold", "value": 55},
      {"label": "Voice", "left": "Formal", "right": "Casual", "value": 60}
    ]
  },
  "directions": [
    {
      "id": 1,
      "name": "Neighborhood Fun",
      "tone": "Warm and welcoming",
      "visual_style": "Sunlit editorial",
      "creative_intent": "Make local routine feel special",
      "palette": ["#F4C95D"],
      "channels": ["Instagram"],
      "why_it_works": "Fits neighborhood ritual."
    },
    {
      "id": 2,
      "name": "Premium Artisan",
      "tone": "Craft-led",
      "visual_style": "Minimal still life",
      "creative_intent": "Emphasize seasonal making",
      "palette": ["#22313F"],
      "channels": ["Menu"],
      "why_it_works": "Signals considered quality."
    },
    {
      "id": 3,
      "name": "Internet Chaos",
      "tone": "Playful and loud",
      "visual_style": "High-contrast collage",
      "creative_intent": "Create fast social attention",
      "palette": ["#FF4D6D"],
      "channels": ["TikTok"],
      "why_it_works": "Creates a sharp, shareable contrast."
    }
  ],
  "round": 1,
  "status": "active",
  "rejections": [],
  "constraints": [],
  "refined_direction": null,
  "artifact": null,
  "updated_at": "2026-07-22T00:00:00+00:00"
}
```

Every session response has exactly three `directions`. `Direction` is object with `id`, `name`, `tone`, `visual_style`, `creative_intent`, `palette`, `channels`, and `why_it_works`. `Artifact` is object with `caption`, SVG string `layout_mock_svg`, and three-string `rationale`.

## `POST /creative/start`

Creates session in `active` status with DNA and three directions. Returns `201 Created` plus `CreativeSession`.

```json
{
  "brand_name": "Northstar Coffee",
  "description": "A premium coffee brand for busy city mornings.",
  "goal": "Get more menu photo clicks from Google Maps",
  "reference": "Warm but confident; not meme-y"
}
```

Fields: `brand_name` required, trimmed, 1–80 characters; `description` required, trimmed, 5–280; `goal` optional null or trimmed 10–500; `reference` optional null or trimmed 1–240.

## `POST /creative/reject`

Accepts exactly two distinct existing directions in one request. Both rejections produce constraints and one refined direction; response is `CreativeSession` with `status: "refined_ready"`.

```json
{
  "session_id": "uuid",
  "rejections": [
    {"direction_id": 2, "reason": "too_loud", "note": "Feels like hype"},
    {"direction_id": 3, "reason": "not_our_audience", "note": "Too young"}
  ]
}
```

`session_id` is required non-empty trimmed string. `rejections` length is exactly 2; `direction_id` is integer at least 1 and ids must differ. `reason` is one of `too_generic`, `too_loud`, `not_our_audience`, `not_authentic`, or `other`. `note` is optional null or trimmed 1–240 characters.

## `POST /creative/approve`

Only approves a refined direction. Request:

```json
{"session_id": "uuid"}
```

Returns `CreativeSession` with `status: "approved"`. Approval cannot skip refinement. Approval is idempotent after success: retrying while already `approved` returns current session, and retrying after `executed` returns current executed session without changing it. This makes a retry safe when successful approval response was lost.

## `POST /creative/execute`

Only executes an approved direction. Request:

```json
{"session_id": "uuid"}
```

Returns `200 OK`:

```json
{
  "session_id": "uuid",
  "status": "executed",
  "artifact": {
    "caption": "...",
    "layout_mock_svg": "<svg ...>...</svg>",
    "rationale": ["...", "...", "..."]
  },
  "direction": {
    "id": 10,
    "name": "...",
    "tone": "...",
    "visual_style": "...",
    "creative_intent": "...",
    "palette": ["..."],
    "channels": ["..."],
    "why_it_works": "..."
  }
}
```

Execution is idempotent: execute after `executed` returns same persisted artifact and direction without generating another artifact.

## Lifecycle and errors

State flow is `active` → `refined_ready` → `approved` → `executed`. `/reject` only works while active; `/approve` transitions refined-ready and safely reads already approved/executed state; `/execute` works while approved or executed.

Every stored session has an internal `user_id` owner. Hermes and persistence operations require that owner for create, load, save, reject, approve, and execute; a session owned by another user—or persisted state whose embedded owner/session key is inconsistent—is indistinguishable from a missing session and is never cached or mutated.

Until Task 3 connects request authentication, HTTP routes use a narrow transitional resolver and do not expose `user_id` in response payloads. In memory mode it uses a deterministic valid UUID. When `SUPABASE_URL` is configured, `CREATIVE_DEMO_USER_ID` must be a syntactically valid UUID for an existing local `auth.users` row. Missing or malformed configuration returns `503` before Hermes persistence is called. A supplied UUID is canonicalized before every lifecycle call. Task 3 removes this resolver in favor of verified request identity.

- `404`: session missing.
- `409`: unknown direction, duplicate rejection direction ids, or invalid lifecycle transition.
- `422`: Pydantic request validation failure, including invalid fields or rejection list length.
- `503`: transitional local Supabase owner configuration missing or malformed.
