import { describe, expect, it } from "vitest";

import { contrastRatio, derivePrintAccent, deriveProjectTheme } from "./project-theme";
import type { GraphNode } from "./project-types";

const decision = (content: string, state: GraphNode["state"] = "approved"): GraphNode => ({
  id: "n", project_id: "p", node_type: "decision", title: "Palette", content, state,
  created_by: "user", provenance: null, tags: ["visual-palette"], version: 1,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
});

const taggedDecision = (tag: string): GraphNode => ({ ...decision("prose without colors"), tags: ["section:visual-direction", tag] });

describe("project themes", () => {
  it.each(["paper", "graphite"] as const)("meets text, control-boundary, and focus contrast in %s", (choice) => {
    const { tokens } = deriveProjectTheme(choice, []);
    expect(contrastRatio(tokens.foreground, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.muted, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.controlBorder, tokens.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens.focus, tokens.surface)).toBeGreaterThanOrEqual(3);
  });

  it("keeps Project control boundaries and focus visible with hostile approved accents", () => {
    const { tokens } = deriveProjectTheme("project", [decision("#ffffff #ffff00 #eeeeee")]);
    expect(contrastRatio(tokens.controlBorder, tokens.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens.focus, tokens.surface)).toBeGreaterThanOrEqual(3);
  });
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

  it("derives Project accent from validated palette metadata instead of prose", () => {
    const result = deriveProjectTheme("project", [taggedDecision("palette:#1F4D3A,#F5EBDD")]);
    expect(result.sourcePalette).toEqual(["#1f4d3a", "#f5ebdd"]);
    expect(result.tokens.accent).toBe("#1f4d3a");
  });

  it.each(["#ffffff #ffff00", "#000000 #111111", "#ff00ff #00ffff"])(
    "keeps neutral chrome and derives a safe accent from hostile palette %s", (content) => {
      const paper = deriveProjectTheme("paper", []);
      const result = deriveProjectTheme("project", [decision(content)]);
      expect(result.tokens.background).toBe(paper.tokens.background);
      expect(result.tokens.surface).toBe(paper.tokens.surface);
      expect(result.tokens.foreground).toBe(paper.tokens.foreground);
      expect(result.sourcePalette).toEqual(content.split(" "));
      expect(result.accentContrast).toBeGreaterThanOrEqual(3);
      expect(result.accentTextContrast).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("derives print accents with 3:1 white-paper contrast for every theme and hostile palettes", () => {
    const accents = [
      deriveProjectTheme("paper", []).tokens.accent,
      deriveProjectTheme("graphite", []).tokens.accent,
      deriveProjectTheme("project", [decision("#ffff00 #ffffff #00ffff")]).tokens.accent,
      "#ffff00",
    ];
    for (const accent of accents) {
      const printable = derivePrintAccent(accent);
      expect(contrastRatio(printable, "#ffffff")).toBeGreaterThanOrEqual(3);
    }
  });
});
