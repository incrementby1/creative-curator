# Client flow (single page)

The UI is intentionally a **single page**: `client/app/page.tsx`.

## Stages

1. **Intake**
   - Inputs:
     - brand name (required)
     - one-sentence description (required)
     - optional reference
     - optional goal
   - Action: `POST /api/creative/start`

2. **Brand DNA hypothesis**
   - Display only (not interactive yet):
     - 3 beliefs
     - 2 tone sliders rendered visually

3. **3 creative directions**
   - Each card shows:
     - name, tone, visual style, creative intent
     - palette swatches
     - channels
     - why it works

4. **Rejection interface (core MVP loop)**
   - User must select **exactly 2** directions to reject.
   - For each selected direction:
     - choose one structured rejection reason
     - optional note
   - Action: `POST /api/creative/reject`
     - once backend has 2 rejections, it returns:
       - `constraints`
       - `refined_direction`
       - `status = refined_ready`

5. **Refined direction**
   - UI displays the refined direction card.
   - The backend encodes “since you rejected …” behavior via constraints surfaced in:
     - `session.constraints` and the direction’s `why_it_works`.

6. **Approve + execute final artifact**
   - Action chain:
     1) `POST /api/creative/approve`
     2) `POST /api/creative/execute`
   - UI displays:
     - caption
     - SVG layout mock (rendered via `dangerouslySetInnerHTML`)
     - 3-bullet rationale (including what was avoided due to rejection)

## Error handling

- All actions are wrapped with `busy` + `error` state.
- The UI blocks rejection submission unless exactly 2 directions are selected.
