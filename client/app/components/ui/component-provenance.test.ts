import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("visual source contracts", () => {
  it("defines all semantic theme and motion tokens", () => {
    const tokens = read("app/styles/tokens.css");
    for (const token of ["canvas", "panel", "panel-elevated", "text", "text-muted", "border", "hover", "selection", "focus", "handle", "edge-supports", "edge-contradicts", "edge-depends", "edge-inspires", "edge-supersedes", "warning", "error", "success", "challenge"]) {
      expect(tokens).toContain(`--workbench-${token}`);
    }
    expect(tokens).toContain('[data-theme="paper"]');
    expect(tokens).toContain('[data-theme="graphite"]');
    expect(tokens).toContain('[data-theme="project"]');
    expect(read("app/styles/workbench.css")).toContain("prefers-reduced-motion: reduce");
  });

  it("records reviewed provenance and rejects prototype hazards", () => {
    const provenance = read("../docs/COMPONENT_PROVENANCE.md");
    for (const pattern of ["shell", "panel", "toolbar", "node", "resizer", "chat panel", "freehand"]) expect(provenance.toLowerCase()).toContain(pattern);
    for (const hazard of ["monolithic local state", "hard-coded colors", "base64 image storage", "canvas-reset remount", "unlabeled icon-only controls", "undeclared dependencies"]) expect(provenance).toContain(hazard);
  });

  it("has no unsafe rendering, remote registry imports, or prohibited effects", () => {
    const files = fs.readdirSync(path.join(root, "app/components"), { recursive: true }).filter((file) => /\.(ts|tsx)$/.test(String(file)) && !/\.test\./.test(String(file)));
    const source = files.map((file) => read(`app/components/${String(file)}`)).join("\n");
    expect(source).not.toContain(["dangerously", "SetInnerHTML"].join(""));
    expect(source).not.toMatch(/from ["']https?:\/\//);
    expect(source).not.toMatch(/backdrop-filter|backdrop-blur|filter:\s*blur|animation:\s*[^;]*infinite|skew\(/);
    const cssFiles = fs.readdirSync(path.join(root, "app"), { recursive: true }).filter((file) => /\.css$/.test(String(file)));
    const css = cssFiles.map((file) => read(`app/${String(file)}`)).join("\n");
    expect(css).not.toMatch(/backdrop-filter|backdrop-blur|filter:\s*blur|animation:\s*[^;]*infinite|skew\(|radial-gradient|linear-gradient/);
  });

  it("keeps Motion transforms away from React Flow node interaction geometry", () => {
    const node = read("app/components/constellation/nodes/brand-node.tsx");
    expect(node).not.toMatch(/motion\.article|animate=\{\{[^}]*scale|initial=\{[^}]*scale/);
  });
});
