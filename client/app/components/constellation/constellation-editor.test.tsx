import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { AnnotationLayer, annotationPath } from "./annotation-layer";
import { BrandNode, brandNodeTypes } from "./nodes/brand-node";
import { edgeDashPattern, semanticEdgeClass, semanticEdgeLabel, semanticEdgeTypes } from "./edges/semantic-edge";
import { MediaAnnotation } from "./media-annotation";
import type { CanvasAnnotation, GraphNode } from "../../lib/project-types";

const node: GraphNode = {
  id: "node-1", project_id: "project-1", node_type: "assumption", title: "People want calm",
  content: "Moving creates avoidable stress.", state: "working", created_by: "user", provenance: null,
  tags: [], version: 1, created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:00Z",
};

describe("constellation renderers", () => {
  it("keeps memoized definitions outside render scope", () => {
    expect(brandNodeTypes).toBe(brandNodeTypes);
    expect(semanticEdgeTypes).toBe(semanticEdgeTypes);
  });

  it("shows node type, lifecycle, preview, handles, and resizer without editable controls", () => {
    const props = {
      id: node.id, data: { record: node, preview: true }, selected: true, type: "brand",
      dragging: false, draggable: true, selectable: true, deletable: true, zIndex: 1,
      isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
    } as unknown as ComponentProps<typeof BrandNode>;
    render(<ReactFlowProvider><BrandNode {...props} /></ReactFlowProvider>);
    expect(screen.getByText("Assumption")).toBeVisible();
    expect(screen.getByText("Working")).toBeVisible();
    expect(screen.getByText("Proposal preview")).toBeVisible();
    expect(screen.getByLabelText("Incoming relationships")).toBeVisible();
    expect(screen.getByLabelText("Outgoing relationships")).toBeVisible();
    expect(document.querySelector(".react-flow__resize-control")).toBeTruthy();
    expect(document.querySelector("input, textarea, select, [contenteditable=true]")).toBeNull();
  });

  it("renders content as text and gives relationship types text plus pattern", () => {
    const unsafe = { ...node, title: "<img src=x onerror=alert(1)>", content: "<script>bad()</script>" };
    const props = { id: unsafe.id, data: { record: unsafe }, selected: false,
      type: "brand", dragging: false, draggable: true, selectable: true, deletable: true, zIndex: 1,
      isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0 } as unknown as ComponentProps<typeof BrandNode>;
    render(<ReactFlowProvider><BrandNode {...props} /></ReactFlowProvider>);
    expect(screen.getByText(unsafe.title)).toBeVisible();
    expect(document.querySelector("script, img")).toBeNull();
    expect(edgeDashPattern("contradicts")).not.toBe(edgeDashPattern("supports"));
    expect(semanticEdgeLabel("depends_on")).toBe("depends on");
  });

  it.each(["supports", "contradicts", "depends_on", "inspires", "supersedes"] as const)("binds %s edge to semantic token and text", (type) => {
    expect(semanticEdgeLabel(type)).toBe(type.replaceAll("_", " "));
    expect(semanticEdgeClass(type)).toBe(`semantic-edge--${type.replaceAll("_", "-")}`);
  });
});

describe("annotation layer", () => {
  const annotation: CanvasAnnotation = {
    id: "mark-1", project_id: "project-1", owner_id: "owner-1", annotation_type: "freehand",
    path_points: [[10, 20], [14, 24], [20, 22]], color: "#74432f", media_id: null,
    version: 1, created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:00Z",
  };

  it("renders freehand paths in viewport-synchronized sibling SVG", () => {
    const dispatch = vi.fn();
    const { container } = render(<AnnotationLayer annotations={[annotation]} currentPoints={[]}
      mode="select" onAction={dispatch} viewport={{ x: 40, y: 30, zoom: 1.5 }} />);
    expect(container.querySelector("svg[data-annotation-layer='true']")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("g")).toHaveAttribute("transform", "translate(40 30) scale(1.5)");
    expect(container.querySelector("path")).toHaveAttribute("d", annotationPath(annotation.path_points));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches only annotation records when erasing", () => {
    const dispatch = vi.fn();
    const { container } = render(<AnnotationLayer annotations={[annotation]} currentPoints={[]}
      mode="erase" onAction={dispatch} viewport={{ x: 0, y: 0, zoom: 1 }} />);
    fireEvent.pointerDown(container.querySelector("path")!);
    expect(dispatch).toHaveBeenCalledWith({ type: "replace", annotations: [] });
    expect(JSON.stringify(dispatch.mock.calls)).not.toContain("semantic");
  });

  it("keeps media references out of semantic nodes", () => {
    expect(JSON.stringify(node)).not.toContain("data:image");
    expect(annotation.annotation_type).toBe("freehand");
  });
});

describe("persisted media", () => {
  it("uses owned bounded-object handles and revokes them on unmount", async () => {
    const revoke = vi.fn();
    const { unmount } = render(<MediaAnnotation alt="Reference image" load={async () => ({ url: "blob:owned-reference", revoke })} />);
    const image = await screen.findByRole("img", { name: "Reference image" });
    expect(image).toHaveAttribute("src", "blob:owned-reference");
    expect(image.getAttribute("src")).not.toMatch(/^data:/);
    unmount();
    await waitFor(() => expect(revoke).toHaveBeenCalledOnce());
  });
});
