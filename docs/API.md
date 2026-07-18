# Backend API

Base: the client proxies `/api/creative/*` to the FastAPI backend `/creative/*` via `client/next.config.ts`.

All endpoints are JSON.

## Endpoints

### `POST /creative/start`

Creates a new creative session.

**Request**
```json
{
  "brand_name": "Northstar Coffee",
  "description": "A premium coffee brand for busy city mornings.",
  "goal": "Get more menu photo clicks from Google Maps",
  "reference": "Warm but confident; not meme-y"
}
```

`goal` and `reference` are optional.

**Response (shape)**
```json
{
  "session_id": "uuid",
  "brand_name": "...",
  "description": "...",
  "goal": "...",
  "reference": "...",
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
      "tone": "...",
      "visual_style": "...",
      "creative_intent": "...",
      "palette": ["#...", "#...", "#..."],
      "channels": ["..."],
      "why_it_works": "..."
    }
  ],
  "round": 1,
  "status": "active",
  "rejections": [],
  "constraints": [],
  "refined_direction": null,
  "artifact": null,
  "updated_at": "2026-..."
}
```

### `POST /creative/reject`

Stores structured rejection feedback. Once **2 distinct rejections** are submitted, the backend generates:
- `constraints`
- `refined_direction`
- sets `status = "refined_ready"`

**Request**
```json
{
  "session_id": "uuid",
  "rejections": [
    {"direction_id": 2, "reason": "too_loud", "note": "Feels like hype"},
    {"direction_id": 3, "reason": "not_our_audience", "note": "Too young"}
  ]
}
```

Valid `reason` values:
- `too_generic`
- `too_loud`
- `not_our_audience`
- `not_authentic`
- `other`

**Response**: the updated session (same shape as `/start`).

**Legacy support**: `reasons: [string]` is still accepted for back-compat.

### `POST /creative/approve`

Approves the refined direction (or approves the first direction if refinement was skipped).

**Request**
```json
{ "session_id": "uuid" }
```

**Response**: session (status becomes `approved`).

### `POST /creative/execute`

Generates the single final content artifact.

**Request**
```json
{ "session_id": "uuid" }
```

**Response**
```json
{
  "session_id": "uuid",
  "status": "executed",
  "artifact": {
    "caption": "...",
    "layout_mock_svg": "<svg ...>...",
    "rationale": ["...", "...", "..."]
  },
  "direction": { "id": 10, "name": "...", "tone": "...", "visual_style": "...", "creative_intent": "...", "palette": ["..."], "channels": ["..."], "why_it_works": "..." }
}
```

## Flow contract (what the judge sees)

1. `/start` produces a *first guess* (DNA + 3 divergent directions)
2. `/reject` transforms labeled rejection into constraints
3. Once 2 rejections exist, backend returns a refined direction and explicitly references what changed in `why_it_works`
4. `/approve` marks the refined direction as the chosen path
5. `/execute` returns a single caption + a visual layout mock + rationale, including what was avoided due to rejection
