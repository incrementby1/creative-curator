import type { GraphNode, ThemeChoice } from "./project-types";

export type ThemeTokens = Readonly<{ background: string; surface: string; foreground: string; muted: string; border: string; accent: string; accentText: string }>;
export type DerivedTheme = Readonly<{ choice: ThemeChoice; mode: "light" | "dark"; tokens: ThemeTokens; sourcePalette: readonly string[] }>;
const PAPER: ThemeTokens = { background: "#f7f5ef", surface: "#fdfcf8", foreground: "#30322f", muted: "#6b706b", border: "#dedbd2", accent: "#a84f36", accentText: "#ffffff" };
const GRAPHITE: ThemeTokens = { background: "#1f2221", surface: "#292d2b", foreground: "#f4f2ec", muted: "#b5bab5", border: "#4b504d", accent: "#e28a6b", accentText: "#171918" };
const HEX = /#[0-9a-f]{6}/gi;

function luminance(hex: string): number {
  const values = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string): number { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
function palette(nodes: readonly GraphNode[]): string[] {
  const approved = nodes.find((node) => node.node_type === "decision" && node.state === "approved" && node.tags.some((tag) => ["visual-palette", "section:visual-direction"].includes(tag.toLowerCase())));
  return approved?.content.match(HEX)?.map((color) => color.toLowerCase()) ?? [];
}
export function deriveProjectTheme(choice: ThemeChoice, nodes: readonly GraphNode[]): DerivedTheme {
  if (choice === "graphite") return { choice, mode: "dark", tokens: GRAPHITE, sourcePalette: [] };
  if (choice === "paper") return { choice, mode: "light", tokens: PAPER, sourcePalette: [] };
  const sourcePalette = palette(nodes);
  if (!sourcePalette.length) return { choice, mode: "light", tokens: PAPER, sourcePalette: [] };
  const background = sourcePalette[0];
  const foreground = contrast(background, "#202220") >= 4.5 ? "#202220" : "#ffffff";
  const candidateAccent = sourcePalette.find((color) => contrast(color, background) >= 3 && contrast(color, foreground) >= 3);
  const accent = candidateAccent ?? (contrast(PAPER.accent, background) >= 3 ? PAPER.accent : foreground);
  return { choice, mode: foreground === "#ffffff" ? "dark" : "light", sourcePalette,
    tokens: { background, surface: background, foreground, muted: foreground, border: foreground, accent,
      accentText: contrast(accent, "#ffffff") >= 4.5 ? "#ffffff" : "#202220" } };
}
