import { describe, expect, it } from "vitest";

import { createAnnotationState, reduceAnnotationAction } from "./project-annotations";

describe("annotation-only reducer", () => {
  it("undoes and redoes annotations without accepting semantic records", () => {
    const initial = createAnnotationState([], 2);
    const drawn = reduceAnnotationAction(initial, { type: "replace", annotations: [{
      id: "a", project_id: "p", owner_id: "u", annotation_type: "freehand",
      path_points: [[0, 0], [1, 1]], color: "#111111", media_id: null, version: 1,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    }] });
    expect(initial.annotations).toEqual([]);
    expect(reduceAnnotationAction(drawn, { type: "undo" }).annotations).toEqual([]);
    expect(reduceAnnotationAction(reduceAnnotationAction(drawn, { type: "undo" }), { type: "redo" }).annotations).toHaveLength(1);
    if (false) {
      // @ts-expect-error annotation reducer must reject semantic nodes at compile time
      reduceAnnotationAction(drawn, { type: "replace", nodes: [] });
    }
  });
});
