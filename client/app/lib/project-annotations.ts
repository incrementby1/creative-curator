import type { CanvasAnnotation } from "./project-types";

export type AnnotationState = Readonly<{
  annotations: readonly CanvasAnnotation[];
}>;
export type AnnotationAction =
  | Readonly<{ type: "replace"; annotations: readonly CanvasAnnotation[] }>
  | Readonly<{ type: "remove"; id: string }>
  | Readonly<{ type: "clear" }>;

export function createAnnotationState(annotations: readonly CanvasAnnotation[] = []): AnnotationState {
  return { annotations: [...annotations] };
}
export function reduceAnnotationAction(state: AnnotationState, action: AnnotationAction): AnnotationState {
  if (action.type === "clear") return { annotations: [] };
  if (action.type === "remove") return { annotations: state.annotations.filter((item) => item.id !== action.id) };
  return { annotations: [...action.annotations] };
}
