import { describe, expect, it } from "vitest";

import { createAnnotationState, reduceAnnotationAction } from "./project-annotations";

describe("annotation-only reducer", () => {
  it("replaces and clears persisted annotation data without owning history", () => {
    const initial = createAnnotationState([]);
    const drawn = reduceAnnotationAction(initial, { type: "replace", annotations: [{
      id: "a", project_id: "p", owner_id: "u", annotation_type: "freehand",
      path_points: [[0, 0], [1, 1]], color: "#111111", media_id: null, version: 1,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    }] });
    expect(initial.annotations).toEqual([]);
    expect(drawn.annotations).toHaveLength(1);
    expect(reduceAnnotationAction(drawn, { type: "clear" })).toEqual({ annotations: [] });
    expect(Object.keys(drawn)).toEqual(["annotations"]);
    if (false) {
      // @ts-expect-error annotation reducer must reject semantic nodes at compile time
      reduceAnnotationAction(drawn, { type: "replace", nodes: [] });
    }
  });
});
