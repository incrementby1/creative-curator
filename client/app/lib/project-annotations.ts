import type { CanvasAnnotation } from "./project-types";

export type AnnotationState = Readonly<{
  annotations: readonly CanvasAnnotation[]; past: readonly (readonly CanvasAnnotation[])[];
  future: readonly (readonly CanvasAnnotation[])[]; historyLimit: number;
}>;
export type AnnotationAction =
  | Readonly<{ type: "replace"; annotations: readonly CanvasAnnotation[] }>
  | Readonly<{ type: "undo" }>
  | Readonly<{ type: "redo" }>
  | Readonly<{ type: "clear" }>;

export function createAnnotationState(annotations: readonly CanvasAnnotation[] = [], historyLimit = 50): AnnotationState {
  return { annotations: [...annotations], past: [], future: [], historyLimit: Math.max(1, historyLimit) };
}
export function reduceAnnotationAction(state: AnnotationState, action: AnnotationAction): AnnotationState {
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { ...state, annotations: previous, past: state.past.slice(0, -1), future: [[...state.annotations], ...state.future].slice(0, state.historyLimit) } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { ...state, annotations: next, past: [...state.past, [...state.annotations]].slice(-state.historyLimit), future: state.future.slice(1) } : state;
  }
  const annotations = action.type === "clear" ? [] : [...action.annotations];
  return { ...state, annotations, past: [...state.past, [...state.annotations]].slice(-state.historyLimit), future: [] };
}
