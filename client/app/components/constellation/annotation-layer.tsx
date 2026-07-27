"use client";

import { getStroke } from "perfect-freehand";
import type { CanvasAnnotation } from "../../lib/project-types";
import type { AnnotationAction } from "../../lib/project-annotations";

export type CanvasMode = "select" | "connect" | "draw" | "erase";
export type Viewport = Readonly<{ x: number; y: number; zoom: number }>;

export function annotationPath(points: readonly (readonly [number, number])[]): string {
  const stroke = getStroke(points.map(([x, y]) => [x, y]), { size: 6, thinning: .55, smoothing: .55, streamline: .45 });
  if (!stroke.length) return "";
  const commands: Array<string | number> = ["M", stroke[0][0], stroke[0][1], "Q"];
  stroke.forEach(([x, y], index) => {
    const next = stroke[(index + 1) % stroke.length];
    commands.push(x, y, (x + next[0]) / 2, (y + next[1]) / 2);
  });
  commands.push("Z");
  return commands.join(" ");
}

export function AnnotationLayer({ annotations, currentPoints, mode, onAction, viewport }: {
  annotations: readonly CanvasAnnotation[]; currentPoints: readonly (readonly [number, number])[];
  mode: CanvasMode; onAction: (action: AnnotationAction) => void; viewport: Viewport;
}) {
  const freehand = annotations.filter((item) => item.annotation_type === "freehand");
  const erase = (id: string) => onAction({ type: "remove", id });
  return <svg aria-hidden="true" className="annotation-layer" data-annotation-layer="true">
    <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
      {freehand.map((item) => <path d={annotationPath(item.path_points)} fill={item.color ?? "currentColor"} key={item.id}
        onPointerDown={() => mode === "erase" && erase(item.id)} style={{ pointerEvents: mode === "erase" ? "stroke" : "none" }} />)}
      {currentPoints.length > 1 && <path d={annotationPath(currentPoints)} fill="currentColor" />}
    </g>
  </svg>;
}
