export const BLUEPRINT_SECTIONS = ["purpose", "audience", "positioning", "promise", "personality-voice", "naming", "messaging", "visual-direction", "evidence-assumptions", "unresolved-challenges", "next-actions"] as const;
export type BlueprintSectionSlug = typeof BLUEPRINT_SECTIONS[number];
export type NodeTaxonomy = Readonly<{ section: BlueprintSectionSlug | ""; branch: string; cluster: string; palette: string }>;

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slug = (value: string, name: string): string => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized && (!SAFE_SLUG.test(normalized) || normalized.length > 64)) throw new Error(`${name} must use letters, numbers, spaces, or hyphens.`);
  return normalized;
};
const luminance = (hex: string): number => {
  const rgb = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
};
export function validatePalette(value: string): string | null {
  const colors = value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  if (!colors.length || colors.length > 8 || colors.some((item) => !/^#[0-9A-F]{6}$/.test(item))) return null;
  const contrast = (a: string, b: string) => { const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (bright + .05) / (dark + .05); };
  if (colors.length > 1 && Math.max(...colors.flatMap((a) => colors.map((b) => contrast(a, b)))) < 3) return null;
  return colors.join(",");
}
export function parseNodeTags(tags: readonly string[]): NodeTaxonomy {
  const get = (prefix: string) => tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length) ?? "";
  const rawSection = get("section:");
  return { section: BLUEPRINT_SECTIONS.includes(rawSection as BlueprintSectionSlug) ? rawSection as BlueprintSectionSlug : "", branch: get("branch:"), cluster: get("cluster:"), palette: get("palette:") };
}
export function buildNodeTags(value: NodeTaxonomy, existing: readonly string[] = []): string[] {
  if (value.section && !BLUEPRINT_SECTIONS.includes(value.section)) throw new Error("Blueprint section is invalid.");
  const branch = slug(value.branch, "branch"); const cluster = slug(value.cluster, "cluster");
  const palette = value.palette.trim() ? validatePalette(value.palette) : "";
  if (value.palette.trim() && !palette) throw new Error("Palette needs 6-digit hex colors with at least one 3:1 contrast pair.");
  return [...existing.filter((tag) => !/^(section|branch|cluster|palette):/.test(tag)), ...(value.section ? [`section:${value.section}`] : []), ...(branch ? [`branch:${branch}`] : []), ...(cluster ? [`cluster:${cluster}`] : []), ...(palette ? [`palette:${palette}`] : [])];
}
