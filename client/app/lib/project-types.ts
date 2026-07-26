export type NodeType = "evidence" | "assumption" | "idea" | "decision" | "challenge" | "output";
export type NodeState = "working" | "approved" | "trash";
export type EdgeType = "supports" | "contradicts" | "depends_on" | "inspires" | "supersedes";
export type AnnotationType = "freehand" | "media";
export type CreationSource = "user" | "hermes" | "import";
export type ChallengeState = "open" | "acknowledged" | "resolved" | "deferred" | "overridden";
export type ProposalState = "pending" | "accepted" | "rejected";
export type ProjectStatus = "active" | "archived";
export type ThemeChoice = "paper" | "graphite" | "project";

export type Project = Readonly<{
  id: string; owner_id: string; title: string; status: ProjectStatus; theme: ThemeChoice;
  version: number; created_at: string; updated_at: string;
}>;

export type GraphNode = Readonly<{
  id: string; project_id: string; node_type: NodeType; title: string; content: string;
  state: NodeState; created_by: CreationSource; provenance: string | null;
  tags: readonly string[]; version: number; created_at: string; updated_at: string;
}>;

export type GraphEdge = Readonly<{
  id: string; project_id: string; source_node_id: string; target_node_id: string;
  edge_type: EdgeType; label: string | null; version: number; created_at: string; updated_at: string;
}>;

export type CanvasAnnotation = Readonly<{
  id: string; project_id: string; owner_id: string; annotation_type: AnnotationType;
  path_points: readonly (readonly [number, number])[]; color: string | null; media_id: string | null;
  version: number; created_at: string; updated_at: string;
}>;

export type CanvasMedia = Readonly<{
  id: string; project_id: string; owner_id: string; storage_key: string; mime_type: string;
  byte_length: number; sha256: string; version: number; created_at: string; updated_at: string;
}>;
export type UploadedCanvasMedia = CanvasMedia & Readonly<{ upload_claim: string }>;

export type NodeRevision = Readonly<{
  id: string; project_id: string; node_id: string; node_version: number; title: string;
  content: string; node_type: NodeType; state: NodeState; created_by: CreationSource;
  provenance: string | null; tags: readonly string[]; created_at: string;
}>;

export type AnalysisProposal = Readonly<{
  id: string; project_id: string; title: string; rationale: string; target_node_ids: readonly string[];
  canonical_hash: string; dependency_node_versions: readonly (readonly [string, number])[];
  dependency_edge_versions: readonly (readonly [string, number])[]; creation_source: CreationSource;
  state: ProposalState; version: number; created_at: string; updated_at: string;
}>;
export type ProposedNode = Readonly<{
  client_key: string; node_type: Exclude<NodeType, "output">; title: string; content: string; rationale: string;
}>;
export type ProposedEdge = Readonly<{ source_key: string; target_key: string; edge_type: EdgeType }>;
export type ProposalCandidate = Readonly<{
  summary: string; proposed_nodes: readonly ProposedNode[]; proposed_edges: readonly ProposedEdge[];
  affected_node_ids: readonly string[];
}>;
export type ProposalWithCandidate = Readonly<{ proposal: AnalysisProposal; candidate: ProposalCandidate }>;
export type ListedProposal = AnalysisProposal & Readonly<{ candidate: ProposalCandidate }>;
export type AcceptedProposal = Readonly<{ proposal: AnalysisProposal; nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }>;

export type ChallengeResolution = Readonly<{
  id: string; project_id: string; challenge_id: string; resolution: string; state: ChallengeState;
  resolved_by: string | null; version: number; created_at: string; updated_at: string;
}>;

export type BlueprintReadinessSection = Readonly<{
  ready: boolean; approved_decision_ids: readonly string[]; blocking_challenge_ids: readonly string[];
}>;
export type BlueprintReadiness = Readonly<{
  project_id: string; project_version: number; ready: boolean;
  sections: Readonly<Record<string, BlueprintReadinessSection>>; warnings: readonly string[];
}>;
export type BlueprintSection = Readonly<{
  ready: boolean; source_node_ids: readonly string[]; decision_ids: readonly string[];
  evidence_ids: readonly string[]; assumption_ids: readonly string[]; challenge_ids: readonly string[];
  blocking_challenge_ids: readonly string[]; entries: readonly Readonly<Record<string, string>>[];
}>;
export type BlueprintSnapshot = Readonly<{
  id: string; project_id: string; name: string; node_ids: readonly string[]; edge_ids: readonly string[];
  version: number; created_at: string; project_version: number; sequence: number;
  readiness_warnings: readonly string[]; unresolved_assumption_ids: readonly string[];
  sections: Readonly<Record<string, BlueprintSection>>;
}>;

export type ProjectGraph = Readonly<{
  project: Project; nodes: readonly GraphNode[]; edges: readonly GraphEdge[];
  layout_version: number; layout: Readonly<Record<string, readonly [number, number]>>;
  annotation_version: number; annotations: readonly CanvasAnnotation[]; theme: ThemeChoice;
}>;

export type NodeCreateInput = Readonly<Omit<GraphNode, "id" | "project_id" | "state" | "version" | "created_at" | "updated_at"> & { expected_project_version: number }>;
export type NodeUpdateInput = Readonly<Omit<GraphNode, "id" | "project_id" | "version" | "created_at" | "updated_at"> & { expected_node_version: number; expected_project_version: number }>;
export type EdgeCreateInput = Readonly<Omit<GraphEdge, "id" | "project_id" | "version" | "created_at" | "updated_at"> & { expected_project_version: number }>;
export type EdgeUpdateInput = Readonly<Pick<GraphEdge, "edge_type" | "label"> & { expected_edge_version: number; expected_project_version: number }>;
