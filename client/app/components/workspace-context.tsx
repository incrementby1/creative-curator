"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  creativeApi,
  type CreativeSession,
  type Direction,
  type ExecuteResponse,
  type RejectionInput,
  type RejectionReason,
  type StartSessionInput,
} from "../lib/creative-api";

export type WorkspaceView = "brief" | "dna" | "outputs";
export type Operation = "start" | "reject" | "approve" | "execute" | null;

export type RejectionDraft = {
  selected: boolean;
  reason: RejectionReason;
  note: string;
};

export type BriefDraft = {
  brandName: string;
  description: string;
  goal: string;
  reference: string;
};

const EMPTY_BRIEF_DRAFT: BriefDraft = {
  brandName: "",
  description: "",
  goal: "",
  reference: "",
};

export type WorkspaceContextValue = {
  session: CreativeSession | null;
  briefDraft: BriefDraft;
  rejectionDrafts: Record<number, RejectionDraft>;
  activeView: WorkspaceView;
  operation: Operation;
  error: string;
  errorStatus: number | null;
  errorCode: string | null;
  updateBriefDraft: (change: Partial<BriefDraft>) => void;
  updateRejectionDraft: (
    directionId: number,
    change: Partial<RejectionDraft>,
  ) => void;
  setActiveView: (view: WorkspaceView) => void;
  start: (input: StartSessionInput) => Promise<void>;
  reject: (rejections: RejectionInput[]) => Promise<void>;
  approveAndExecute: () => Promise<void>;
  retryExecute: () => Promise<void>;
  reset: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

function buildRejectionDrafts(
  directions: Direction[],
): Record<number, RejectionDraft> {
  return Object.fromEntries(
    directions.map((direction) => [
      direction.id,
      { selected: false, reason: "too_generic", note: "" },
    ]),
  ) as Record<number, RejectionDraft>;
}

function errorDetails(error: unknown): { message: string; status: number | null; code: string | null } {
  if (error instanceof ApiError) {
    return { message: error.message || "Something went wrong.", status: error.status, code: error.code };
  }

  if (error instanceof TypeError) {
    return { message: "Creative service unavailable.", status: null, code: null };
  }
  if (error instanceof Error) {
    return { message: error.message || "Something went wrong.", status: null, code: null };
  }

  return { message: "Something went wrong.", status: null, code: null };
}

function mergeExecution(
  session: CreativeSession | null,
  sessionId: string,
  execution: ExecuteResponse,
): CreativeSession | null {
  if (!session || session.session_id !== sessionId) return session;

  return {
    ...session,
    status: execution.status,
    artifact: execution.artifact,
    refined_direction: execution.direction,
  };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CreativeSession | null>(null);
  const [briefDraft, setBriefDraft] = useState<BriefDraft>(EMPTY_BRIEF_DRAFT);
  const [rejectionDrafts, setRejectionDrafts] = useState<
    Record<number, RejectionDraft>
  >({});
  const [activeView, setActiveViewState] = useState<WorkspaceView>("brief");
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const beginRequest = useCallback((nextOperation: Exclude<Operation, null>) => {
    const request = ++requestGeneration.current;
    setError("");
    setErrorStatus(null);
    setErrorCode(null);
    setOperation(nextOperation);
    return request;
  }, []);

  const isCurrentRequest = useCallback(
    (request: number) => requestGeneration.current === request,
    [],
  );

  const updateBriefDraft = useCallback((change: Partial<BriefDraft>) => {
    setBriefDraft((current) => ({ ...current, ...change }));
  }, []);

  const setActiveView = useCallback(
    (view: WorkspaceView) => {
      if (view === "brief" || session) {
        setActiveViewState(view);
      }
    },
    [session],
  );

  const updateRejectionDraft = useCallback(
    (directionId: number, change: Partial<RejectionDraft>) => {
      setRejectionDrafts((current) => {
        const draft = current[directionId];
        if (!draft) return current;

        return {
          ...current,
          [directionId]: { ...draft, ...change },
        };
      });
    },
    [],
  );

  const start = useCallback(async (input: StartSessionInput) => {
    const request = beginRequest("start");

    try {
      const createdSession = await creativeApi.start(input);
      if (!isCurrentRequest(request)) return;

      setSession(createdSession);
      setRejectionDrafts(buildRejectionDrafts(createdSession.directions));
      setActiveViewState("dna");
    } catch (caughtError) {
      if (isCurrentRequest(request)) {
        const details = errorDetails(caughtError);
        setError(details.message);
        setErrorStatus(details.status);
        setErrorCode(details.code);
      }
    } finally {
      if (isCurrentRequest(request)) {
        setOperation(null);
      }
    }
  }, [beginRequest, isCurrentRequest]);

  const reject = useCallback(
    async (rejections: RejectionInput[]) => {
      if (!session) {
        setError("Start a creative session before refining directions.");
        setErrorStatus(null);
        setErrorCode(null);
        return;
      }

      const request = beginRequest("reject");

      try {
        const refinedSession = await creativeApi.reject(session.session_id, rejections);
        if (!isCurrentRequest(request)) return;

        setSession(refinedSession);
        setActiveViewState("outputs");
      } catch (caughtError) {
        if (isCurrentRequest(request)) {
          const details = errorDetails(caughtError);
          setError(details.message);
          setErrorStatus(details.status);
          setErrorCode(details.code);
        }
      } finally {
        if (isCurrentRequest(request)) {
          setOperation(null);
        }
      }
    },
    [beginRequest, isCurrentRequest, session],
  );

  const approveAndExecute = useCallback(async () => {
    if (!session) {
      setError("Start a creative session before approving a direction.");
      setErrorStatus(null);
      setErrorCode(null);
      return;
    }

    const request = beginRequest("approve");

    try {
      const approvedSession = await creativeApi.approve(session.session_id);
      if (!isCurrentRequest(request)) return;

      setSession(approvedSession);

      setOperation("execute");
      const execution = await creativeApi.execute(approvedSession.session_id);
      if (!isCurrentRequest(request)) return;

      setSession((currentSession) =>
        mergeExecution(currentSession, approvedSession.session_id, execution),
      );
    } catch (caughtError) {
      if (isCurrentRequest(request)) {
        const details = errorDetails(caughtError);
        setError(details.message);
        setErrorStatus(details.status);
        setErrorCode(details.code);
      }
    } finally {
      if (isCurrentRequest(request)) {
        setOperation(null);
      }
    }
  }, [beginRequest, isCurrentRequest, session]);

  const retryExecute = useCallback(async () => {
    if (!session) {
      setError("Start a creative session before generating an artifact.");
      setErrorStatus(null);
      setErrorCode(null);
      return;
    }

    if (session.status !== "approved" && session.status !== "executed") {
      setError("Approve a refined direction before generating an artifact.");
      setErrorStatus(null);
      setErrorCode(null);
      return;
    }

    const request = beginRequest("execute");

    try {
      const execution = await creativeApi.execute(session.session_id);
      if (!isCurrentRequest(request)) return;

      setSession((currentSession) => mergeExecution(currentSession, session.session_id, execution));
    } catch (caughtError) {
      if (isCurrentRequest(request)) {
        const details = errorDetails(caughtError);
        setError(details.message);
        setErrorStatus(details.status);
        setErrorCode(details.code);
      }
    } finally {
      if (isCurrentRequest(request)) {
        setOperation(null);
      }
    }
  }, [beginRequest, isCurrentRequest, session]);

  const reset = useCallback(() => {
    requestGeneration.current += 1;
    setSession(null);
    setBriefDraft(EMPTY_BRIEF_DRAFT);
    setRejectionDrafts({});
    setError("");
    setErrorStatus(null);
    setErrorCode(null);
    setOperation(null);
    setActiveViewState("brief");
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      session,
      briefDraft,
      rejectionDrafts,
      activeView,
      operation,
      error,
      errorStatus,
      errorCode,
      updateBriefDraft,
      updateRejectionDraft,
      setActiveView,
      start,
      reject,
      approveAndExecute,
      retryExecute,
      reset,
    }),
    [
      activeView,
      approveAndExecute,
      briefDraft,
      error,
      errorCode,
      errorStatus,
      operation,
      rejectionDrafts,
      reject,
      reset,
      retryExecute,
      session,
      setActiveView,
      start,
      updateBriefDraft,
      updateRejectionDraft,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider.");
  }

  return workspace;
}
