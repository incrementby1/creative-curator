"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  NodeProps,
  Node,
  Edge,
  Connection,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  NodeResizer,
} from "@xyflow/react";
import { ArrowUpRight, Image as ImageIcon, Type, MousePointer2, Pencil, Eraser, X } from "lucide-react";
import { getStroke } from "perfect-freehand";

// --- Types ---
type DrawingMode = "pan" | "draw" | "erase";

type Line = {
  id: string;
  points: number[][];
  color?: string;
};

// --- Helper for Freehand SVG Path ---
function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

// --- Doodle Layer Component ---
function DoodleLayer({
  lines,
  currentLine,
  drawingMode,
  onErase,
}: {
  lines: Line[];
  currentLine: number[][] | null;
  drawingMode: DrawingMode;
  onErase: (id: string) => void;
}) {
  const transform = useStore((s) => s.transform);

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 5 }}>
      <g transform={`translate(${transform[0]}, ${transform[1]}) scale(${transform[2]})`}>
        {lines.map((line) => {
          const strokeData = getStroke(line.points, { size: 6, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
          const pathData = getSvgPathFromStroke(strokeData);
          return (
            <path
              key={line.id}
              d={pathData}
              fill={line.color || "#37352F"}
              style={{ pointerEvents: drawingMode === "erase" ? "auto" : "none" }}
              className={drawingMode === "erase" ? "cursor-crosshair hover:opacity-50 transition-opacity" : ""}
              onPointerDown={() => {
                if (drawingMode === "erase") onErase(line.id);
              }}
              onPointerEnter={(e) => {
                if (drawingMode === "erase" && e.buttons === 1) onErase(line.id); // erase while dragging
              }}
            />
          );
        })}
        {currentLine && currentLine.length > 0 && (
          <path
            d={getSvgPathFromStroke(
              getStroke(currentLine, { size: 6, thinning: 0.5, smoothing: 0.5, streamline: 0.5 })
            )}
            fill="#37352F"
          />
        )}
      </g>
    </svg>
  );
}

// --- Custom Node Types ---

function NoteNode({ id, data, selected }: NodeProps) {
  const isHighlighted = data.highlighted;
  const bgColor = (data.bgColor as string) || "#FBFBFA";
  const onEdit = data.onEdit as (id: string, label: string, desc: string, bgColor: string) => void;

  return (
    <div
      className={`shadow-sm rounded-lg p-4 w-full h-full relative group transition-colors ${
        isHighlighted
          ? "border-2 border-emerald-500"
          : selected
          ? "border-2 border-[#D4D4D2]"
          : "border border-[#E9E9E7] hover:border-[#D4D4D2]"
      }`}
      style={{ backgroundColor: bgColor }}
      onDoubleClick={() => onEdit && onEdit(id, data.label as string, (data.desc as string) || "", bgColor as string)}
    >
      <NodeResizer minWidth={200} minHeight={100} isVisible={selected} lineClassName="border-[#a855f7]" handleClassName="bg-[#a855f7]" />
      <Handle type="target" position={Position.Top} className="!bg-purple-500 !w-3 !h-3" />
      <ArrowUpRight
        className={`absolute top-3 right-3 w-4 h-4 transition-opacity ${
          isHighlighted ? "text-emerald-600" : "text-[#91918E]"
        } ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      />
      <div className="w-full h-full flex flex-col overflow-hidden">
        <p className="text-sm font-medium text-[#37352F] pr-6 whitespace-pre-wrap">
          {data.label as string}
        </p>
        {(data.desc as string) && (
          <p className="text-xs text-[#91918E] mt-2 flex-1 overflow-auto whitespace-pre-wrap">
            {data.desc as string}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-3 !h-3" />
    </div>
  );
}

function ImageNode({ id, data, selected }: NodeProps) {
  return (
    <div
      className={`bg-[#FBFBFA] shadow-sm rounded-lg p-2 w-full h-full relative transition-colors ${
        selected ? "border-2 border-[#D4D4D2]" : "border border-[#E9E9E7] hover:border-[#D4D4D2]"
      }`}
    >
      <NodeResizer minWidth={150} minHeight={150} isVisible={selected} lineClassName="border-[#a855f7]" handleClassName="bg-[#a855f7]" />
      <Handle type="target" position={Position.Top} className="!bg-purple-500 !w-3 !h-3" />
      <div className="w-full h-full overflow-hidden rounded-md flex items-center justify-center">
        {data.imageUrl ? (
          <img
            src={data.imageUrl as string}
            alt="User uploaded"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-stone-100 flex items-center justify-center text-[#91918E]">
            <ImageIcon className="w-6 h-6" />
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-3 !h-3" />
    </div>
  );
}

function RootNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`bg-white shadow-sm rounded-lg px-6 py-3 text-sm font-medium transition-colors w-full h-full flex items-center justify-center ${
        selected ? "border-2 border-[#D4D4D2]" : "border border-[#E9E9E7]"
      }`}
    >
      <NodeResizer minWidth={100} minHeight={40} isVisible={selected} lineClassName="border-[#a855f7]" handleClassName="bg-[#a855f7]" />
      {data.label as string}
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-3 !h-3" />
    </div>
  );
}

function StickyNode({ id, data, selected }: NodeProps) {
  const bgColor = (data.bgColor as string) || "#fce7f3"; // pink-100 default
  const onEdit = data.onEdit as (id: string, label: string, desc: string, bgColor: string) => void;

  return (
    <div
      className={`w-full h-full text-[#37352F] p-3 shadow-sm rounded-sm transform transition-transform ${
        selected ? "border-2 border-[#D4D4D2] rotate-0" : "border border-[#D4D4D2] -rotate-3"
      }`}
      style={{ backgroundColor: bgColor }}
      onDoubleClick={() => onEdit && onEdit(id, data.label as string, "", bgColor as string)}
    >
      <NodeResizer minWidth={100} minHeight={100} isVisible={selected} lineClassName="border-[#a855f7]" handleClassName="bg-[#a855f7]" />
      <div className="w-full h-full overflow-auto">
        <p className="text-xs font-medium font-mono leading-relaxed whitespace-pre-wrap">
          {data.label as string}
        </p>
      </div>
    </div>
  );
}

const nodeTypes = {
  note: NoteNode,
  image: ImageNode,
  root: RootNode,
  sticky: StickyNode,
};

// --- Initial Data ---
const initialNodes: Node[] = [
  {
    id: "root",
    type: "root",
    position: { x: 400, y: 100 },
    data: { label: "Output concept" },
    style: { width: 160, height: 46 },
  },
  {
    id: "sticky1",
    type: "sticky",
    position: { x: 200, y: 50 },
    data: { label: "Remember to align with the Q3 brand guidelines!", bgColor: "#fce7f3" },
    style: { width: 160, height: 120 },
  },
  {
    id: "note1",
    type: "note",
    position: { x: 100, y: 300 },
    data: {
      label: "1. Campaign brief snippet",
      desc: "Key takeaways and core messaging pillars for the upcoming product launch.",
      bgColor: "#FBFBFA"
    },
    style: { width: 256, height: 120 },
  },
  {
    id: "note2",
    type: "note",
    position: { x: 400, y: 300 },
    data: {
      label: "2. Target demographic notes",
      desc: "Insights into the primary audience, focusing on millennial professionals.",
      bgColor: "#FBFBFA"
    },
    style: { width: 256, height: 120 },
  },
  {
    id: "note3",
    type: "note",
    position: { x: 700, y: 300 },
    data: {
      label: "3. Execution timeline",
      desc: "Proposed sprint schedule and milestone tracking for the deliverables.",
      highlighted: true,
      bgColor: "#FBFBFA"
    },
    style: { width: 256, height: 120 },
  },
];

const initialEdges: Edge[] = [
  { id: "e-root-note1", source: "root", target: "note1", style: { stroke: "#a855f7", strokeWidth: 2, opacity: 0.6 }, type: "smoothstep" },
  { id: "e-root-note2", source: "root", target: "note2", style: { stroke: "#a855f7", strokeWidth: 2, opacity: 0.6 }, type: "smoothstep" },
  { id: "e-root-note3", source: "root", target: "note3", style: { stroke: "#a855f7", strokeWidth: 2, opacity: 0.6 }, type: "smoothstep" },
];

function CanvasInner() {
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drawing state
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("pan");
  const [lines, setLines] = useState<Line[]>([]);
  const [currentLine, setCurrentLine] = useState<number[][] | null>(null);

  // Editing state
  const [editingNode, setEditingNode] = useState<{ id: string; label: string; desc: string; bgColor: string } | null>(null);

  // Provide edit callback to nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onEdit: (id: string, label: string, desc: string, bgColor: string) => {
            setEditingNode({ id, label, desc, bgColor });
          },
        },
      }))
    );
  }, [setNodes]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({ ...params, style: { stroke: "#a855f7", strokeWidth: 2, opacity: 0.6 }, type: "smoothstep" }, eds)
      ),
    [setEdges]
  );

  const addNote = () => {
    const id = `note-${Date.now()}`;
    const newNode: Node = {
      id,
      type: "note",
      position: { x: Math.random() * 200 + 300, y: Math.random() * 200 + 200 },
      data: {
        label: "New Note",
        desc: "Double click to edit...",
        bgColor: "#FBFBFA",
      },
      style: { width: 256, height: 120 },
    };
    setNodes((nds) => [...nds, newNode]);
    // Immediately open editor
    setEditingNode({ id, label: "New Note", desc: "Double click to edit...", bgColor: "#FBFBFA" });
  };

  const triggerImageUpload = () => {
    fileInputRef.current?.click();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const id = `img-${Date.now()}`;
      const newNode: Node = {
        id,
        type: "image",
        position: { x: Math.random() * 200 + 300, y: Math.random() * 200 + 200 },
        data: { imageUrl: event.target?.result as string },
        style: { width: 256, height: 256 },
      };
      setNodes((nds) => [...nds, newNode]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // --- Drawing Event Handlers ---
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (drawingMode !== "draw") return;
      if ((e.target as HTMLElement).closest(".react-flow__node")) return; // Don't draw on nodes initially
      
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setCurrentLine([[pos.x, pos.y]]);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [drawingMode, screenToFlowPosition]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drawingMode !== "draw" || !currentLine) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setCurrentLine((prev) => (prev ? [...prev, [pos.x, pos.y]] : null));
    },
    [drawingMode, currentLine, screenToFlowPosition]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (drawingMode !== "draw" || !currentLine) return;
      if (currentLine.length > 2) {
        setLines((prev) => [...prev, { id: `line-${Date.now()}`, points: currentLine }]);
      }
      setCurrentLine(null);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [drawingMode, currentLine]
  );

  const handleErase = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  return (
    <div
      className="absolute inset-0"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ touchAction: "none" }} // Prevent browser scrolling while drawing on touch devices
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        panOnDrag={drawingMode === "pan"}
        nodesDraggable={drawingMode === "pan"}
        elementsSelectable={drawingMode === "pan"}
        nodesConnectable={drawingMode === "pan"}
        zoomOnScroll={true}
        zoomOnPinch={true}
        panOnScroll={true}
      >
        <Background color="#E9E9E7" gap={24} size={1.5} style={{ backgroundColor: "#FBFBFA" }} />
        <Controls />
        <DoodleLayer lines={lines} currentLine={currentLine} drawingMode={drawingMode} onErase={handleErase} />
      </ReactFlow>

      {/* Floating Toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 bg-white border border-[#E9E9E7] shadow-lg rounded-full px-2 py-1.5 flex items-center gap-2">
        <div className="flex bg-stone-100 p-1 rounded-full gap-1">
          <button
            onClick={() => setDrawingMode("pan")}
            className={`p-2 rounded-full transition-colors ${drawingMode === "pan" ? "bg-white shadow-sm text-emerald-600" : "text-[#91918E] hover:text-[#37352F]"}`}
            title="Pan/Select"
          >
            <MousePointer2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDrawingMode("draw")}
            className={`p-2 rounded-full transition-colors ${drawingMode === "draw" ? "bg-white shadow-sm text-emerald-600" : "text-[#91918E] hover:text-[#37352F]"}`}
            title="Draw"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDrawingMode("erase")}
            className={`p-2 rounded-full transition-colors ${drawingMode === "erase" ? "bg-white shadow-sm text-emerald-600" : "text-[#91918E] hover:text-[#37352F]"}`}
            title="Erase"
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>
        
        <div className="w-px h-6 bg-[#E9E9E7] mx-1" />
        
        <button
          onClick={addNote}
          className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-[#37352F] hover:bg-stone-50 rounded-full transition-colors"
        >
          <Type className="w-4 h-4" />
          Add Note
        </button>
        <button
          onClick={triggerImageUpload}
          className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-[#37352F] hover:bg-stone-50 rounded-full transition-colors"
        >
          <ImageIcon className="w-4 h-4" />
          Add Image
        </button>
        <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
      </div>

      {/* Pop-up Node Editor Modal */}
      {editingNode && (
        <div className="absolute inset-0 bg-black/20 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md border border-[#E9E9E7] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E9E9E7] bg-[#FBFBFA]">
              <h3 className="font-medium text-[#37352F]">Edit Node</h3>
              <button onClick={() => setEditingNode(null)} className="text-[#91918E] hover:text-[#37352F]">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#91918E] uppercase tracking-wider mb-1">Label</label>
                <input
                  type="text"
                  className="w-full bg-[#FBFBFA] border border-[#E9E9E7] rounded-md px-3 py-2 text-sm text-[#37352F] outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                  value={editingNode.label}
                  onChange={(e) => setEditingNode({ ...editingNode, label: e.target.value })}
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-[11px] font-semibold text-[#91918E] uppercase tracking-wider mb-1">Description (Optional)</label>
                <textarea
                  className="w-full bg-[#FBFBFA] border border-[#E9E9E7] rounded-md px-3 py-2 text-sm text-[#37352F] outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all h-24 resize-none"
                  value={editingNode.desc}
                  onChange={(e) => setEditingNode({ ...editingNode, desc: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#91918E] uppercase tracking-wider mb-2">Background Color</label>
                <div className="flex gap-2">
                  {["#FBFBFA", "#fce7f3", "#dcfce3", "#e0e7ff", "#fef9c3", "#f3f4f6"].map((color) => (
                    <button
                      key={color}
                      onClick={() => setEditingNode({ ...editingNode, bgColor: color })}
                      className={`w-6 h-6 rounded-full border shadow-sm transition-transform ${
                        editingNode.bgColor === color ? "border-emerald-500 scale-110 ring-2 ring-emerald-200" : "border-stone-300 hover:scale-110"
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Select color ${color}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="px-4 py-3 bg-[#FBFBFA] border-t border-[#E9E9E7] flex justify-end gap-2">
              <button
                onClick={() => setEditingNode(null)}
                className="px-4 py-2 text-sm font-medium text-[#37352F] hover:bg-[#E9E9E7] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setNodes((ns) =>
                    ns.map((n) =>
                      n.id === editingNode.id
                        ? { ...n, data: { ...n.data, label: editingNode.label, desc: editingNode.desc, bgColor: editingNode.bgColor } }
                        : n
                    )
                  );
                  setEditingNode(null);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-md transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
