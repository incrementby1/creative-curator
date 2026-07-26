import { describe, expect, it } from "vitest";
import { buildNodeTags, parseNodeTags, validatePalette } from "./project-taxonomy";

describe("project taxonomy", () => {
  it("round trips typed section, branch, cluster, and safe metadata", () => {
    expect(parseNodeTags(buildNodeTags({ section: "visual-direction", branch: "Bold launch", cluster: "Identity", palette: "#1F4D3A,#F5EBDD" }))).toEqual({
      section: "visual-direction", branch: "bold-launch", cluster: "identity", palette: "#1F4D3A,#F5EBDD",
    });
  });

  it("rejects unsafe or inaccessible palette metadata", () => {
    expect(() => buildNodeTags({ section: "purpose", branch: "<script>", cluster: "", palette: "" })).toThrow("branch");
    expect(validatePalette("red, url(x)")).toBeNull();
    expect(validatePalette("#FFFFFF,#FEFEFE")).toBeNull();
  });
});
