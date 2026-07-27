import type { CanvasAnnotation } from "./project-types";

export type AnnotationState = Readonly<{
  annotations: readonly CanvasAnnotation[];
}>;
export type AnnotationAction =
  | Readonly<{ type: "replace"; annotations: readonly CanvasAnnotation[] }>
  | Readonly<{ type: "clear" }>;

export function createAnnotationState(annotations: readonly CanvasAnnotation[] = []): AnnotationState {
  return { annotations: [...annotations] };
}
export function reduceAnnotationAction(state: AnnotationState, action: AnnotationAction): AnnotationState {
  return { annotations: action.type === "clear" ? [] : [...action.annotations] };
}
