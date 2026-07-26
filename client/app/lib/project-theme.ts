import type { GraphNode, ThemeChoice } from "./project-types";

export type ThemeTokens = Readonly<{ background: string; surface: string; foreground: string; muted: string; border: string; controlBorder: string; focus: string; accent: string; accentText: string }>;
export type DerivedTheme = Readonly<{ choice: ThemeChoice; mode: "light" | "dark"; tokens: ThemeTokens; sourcePalette: readonly string[]; accentContrast: number; accentTextContrast: number }>;
const PAPER: ThemeTokens = { background: "#f7f5ef", surface: "#fdfcf8", foreground: "#30322f", muted: "#626862", border: "#d7d4cb", controlBorder: "#777a75", focus: "#8f402d", accent: "#a84f36", accentText: "#ffffff" };
const GRAPHITE: ThemeTokens = { background: "#1f2221", surface: "#292d2b", foreground: "#f4f2ec", muted: "#bdc2bd", border: "#505652", controlBorder: "#747b77", focus: "#ef9b7d", accent: "#e28a6b", accentText: "#171918" };
const HEX = /#[0-9a-f]{6}/gi;

function luminance(hex: string): number {
  const values = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
export function contrastRatio(a: string, b: string): number { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
function palette(nodes: readonly GraphNode[]): string[] {
  const approved = nodes.find((node) => node.node_type === "decision" && node.state === "approved" && node.tags.some((tag) => ["visual-palette", "section:visual-direction"].includes(tag.toLowerCase())));
  return approved?.content.match(HEX)?.map((color) => color.toLowerCase()) ?? [];
}
export function deriveProjectTheme(choice: ThemeChoice, nodes: readonly GraphNode[]): DerivedTheme {
  if (choice === "graphite") return { choice, mode: "dark", tokens: GRAPHITE, sourcePalette: [], accentContrast: contrastRatio(GRAPHITE.accent, GRAPHITE.background), accentTextContrast: contrastRatio(GRAPHITE.accent, GRAPHITE.accentText) };
  if (choice === "paper") return { choice, mode: "light", tokens: PAPER, sourcePalette: [], accentContrast: contrastRatio(PAPER.accent, PAPER.background), accentTextContrast: contrastRatio(PAPER.accent, PAPER.accentText) };
  const sourcePalette = palette(nodes);
  if (!sourcePalette.length) return { choice, mode: "light", tokens: PAPER, sourcePalette: [], accentContrast: contrastRatio(PAPER.accent, PAPER.background), accentTextContrast: contrastRatio(PAPER.accent, PAPER.accentText) };
  const accent = sourcePalette.find((color) => contrastRatio(color, PAPER.background) >= 3 && contrastRatio(color, PAPER.surface) >= 3) ?? PAPER.accent;
  const accentText = contrastRatio(accent, "#ffffff") >= contrastRatio(accent, "#202220") ? "#ffffff" : "#202220";
  return { choice, mode: "light", sourcePalette,
    tokens: { ...PAPER, accent, accentText, focus: accent },
    accentContrast: contrastRatio(accent, PAPER.background), accentTextContrast: contrastRatio(accent, accentText) };
}
