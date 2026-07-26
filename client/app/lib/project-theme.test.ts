import { describe, expect, it } from "vitest";

import { deriveProjectTheme } from "./project-theme";
import type { GraphNode } from "./project-types";

const decision = (content: string, state: GraphNode["state"] = "approved"): GraphNode => ({
  id: "n", project_id: "p", node_type: "decision", title: "Palette", content, state,
  created_by: "user", provenance: null, tags: ["visual-palette"], version: 1,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
});

describe("project themes", () => {
  it("supports Paper and Graphite fixed accessible tokens", () => {
    expect(deriveProjectTheme("paper", []).mode).toBe("light");
    expect(deriveProjectTheme("graphite", []).mode).toBe("dark");
  });

  it("uses Paper until approved palette exists and preserves approved values separately", () => {
    expect(deriveProjectTheme("project", [decision("#ffffff #eeeeee", "working")]).sourcePalette).toEqual([]);
    const result = deriveProjectTheme("project", [decision("#ffffff #ffffff #ff0000")]);
    expect(result.sourcePalette).toEqual(["#ffffff", "#ffffff", "#ff0000"]);
    expect(result.tokens.background).not.toBe(result.tokens.foreground);
  });
});
