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
  type ExecuteResponse,
  type RejectionInput,
  type StartSessionInput,
} from "../lib/creative-api";

export type WorkspaceView = "brief" | "dna" | "outputs";
export type Operation = "start" | "reject" | "approve" | "execute" | null;

export type WorkspaceContextValue = {
  session: CreativeSession | null;
  activeView: WorkspaceView;
  operation: Operation;
  error: string;
  setActiveView: (view: WorkspaceView) => void;
  start: (input: StartSessionInput) => Promise<void>;
  reject: (rejections: RejectionInput[]) => Promise<void>;
  approveAndExecute: () => Promise<void>;
  retryExecute: () => Promise<void>;
  reset: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || "Something went wrong.";
  }

  return "Something went wrong.";
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
  const [activeView, setActiveViewState] = useState<WorkspaceView>("brief");
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);

  const beginRequest = useCallback((nextOperation: Exclude<Operation, null>) => {
    const request = ++requestGeneration.current;
    setError("");
    setOperation(nextOperation);
    return request;
  }, []);

  const isCurrentRequest = useCallback(
    (request: number) => requestGeneration.current === request,
    [],
  );

  const setActiveView = useCallback(
    (view: WorkspaceView) => {
      if (view === "brief" || session) {
        setActiveViewState(view);
      }
    },
    [session],
  );

  const start = useCallback(async (input: StartSessionInput) => {
    const request = beginRequest("start");

    try {
      const createdSession = await creativeApi.start(input);
      if (!isCurrentRequest(request)) return;

      setSession(createdSession);
      setActiveViewState("dna");
    } catch (caughtError) {
      if (isCurrentRequest(request)) {
        setError(errorMessage(caughtError));
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
          setError(errorMessage(caughtError));
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
        setError(errorMessage(caughtError));
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
      return;
    }

    if (session.status !== "approved" && session.status !== "executed") {
      setError("Approve a refined direction before generating an artifact.");
      return;
    }

    const request = beginRequest("execute");

    try {
      const execution = await creativeApi.execute(session.session_id);
      if (!isCurrentRequest(request)) return;

      setSession((currentSession) => mergeExecution(currentSession, session.session_id, execution));
    } catch (caughtError) {
      if (isCurrentRequest(request)) {
        setError(errorMessage(caughtError));
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
    setError("");
    setOperation(null);
    setActiveViewState("brief");
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      session,
      activeView,
      operation,
      error,
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
      error,
      operation,
      reject,
      reset,
      retryExecute,
      session,
      setActiveView,
      start,
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
