"use client";

import { Handle, NodeResizer, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { memo } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { GraphNode } from "../../../lib/project-types";

export type BrandNodeData = { record: GraphNode; preview?: boolean };
const title = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export const BrandNode = memo(function BrandNode({ data, selected }: NodeProps) {
  const { record, preview } = data as unknown as BrandNodeData;
  const reducedMotion = useReducedMotion();
  return (
    <motion.article animate={{ scale: 1 }} className="constellation-node" data-node-type={record.node_type} data-preview={preview || undefined} data-selected={selected || undefined}
      initial={reducedMotion ? false : { scale: .985 }} transition={{ duration: reducedMotion ? 0 : .16 }}>
      <NodeResizer isVisible={selected} minHeight={112} minWidth={208} />
      <Handle aria-label="Incoming relationships" type="target" position={Position.Top} />
      <header><span>{title(record.node_type)}</span><span>{title(record.state)}</span></header>
      {preview && <p className="constellation-node__preview">Proposal preview</p>}
      <h2>{record.title}</h2>
      {record.content && <p>{record.content}</p>}
      <Handle aria-label="Outgoing relationships" type="source" position={Position.Bottom} />
    </motion.article>
  );
});

export const brandNodeTypes: NodeTypes = { brand: BrandNode };
