"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type EdgeTypes } from "@xyflow/react";
import { memo } from "react";
import type { EdgeType } from "../../../lib/project-types";

export const edgeDashPattern = (type: EdgeType): string => ({
  supports: "", contradicts: "8 5", depends_on: "3 4", inspires: "2 7", supersedes: "12 4 2 4",
})[type];
export const semanticEdgeLabel = (type: EdgeType) => type.replaceAll("_", " ");
export const semanticEdgeClass = (type: EdgeType) => `semantic-edge--${type.replaceAll("_", "-")}`;

export const SemanticEdge = memo(function SemanticEdge(props: EdgeProps) {
  const type = (props.data?.edgeType ?? "supports") as EdgeType;
  const [path, labelX, labelY] = getBezierPath(props);
  return <>
    <BaseEdge className={semanticEdgeClass(type)} id={props.id} path={path} markerEnd={props.markerEnd} style={{ ...props.style, strokeDasharray: edgeDashPattern(type) }} />
    <EdgeLabelRenderer><span className={`semantic-edge-label ${semanticEdgeClass(type)}-label`} data-edge-type={type} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{semanticEdgeLabel(type)}</span></EdgeLabelRenderer>
  </>;
});

export const semanticEdgeTypes: EdgeTypes = { semantic: SemanticEdge };
