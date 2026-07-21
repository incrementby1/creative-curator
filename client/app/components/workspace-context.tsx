"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
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

  const setActiveView = useCallback(
    (view: WorkspaceView) => {
      if (view === "brief" || session) {
        setActiveViewState(view);
      }
    },
    [session],
  );

  const start = useCallback(async (input: StartSessionInput) => {
    setError("");
    setOperation("start");

    try {
      const createdSession = await creativeApi.start(input);
      setSession(createdSession);
      setActiveViewState("dna");
    } catch (caughtError) {
      setError(errorMessage(caughtError));
    } finally {
      setOperation(null);
    }
  }, []);

  const reject = useCallback(
    async (rejections: RejectionInput[]) => {
      if (!session) {
        setError("Start a creative session before refining directions.");
        return;
      }

      setError("");
      setOperation("reject");

      try {
        const refinedSession = await creativeApi.reject(session.session_id, rejections);
        setSession(refinedSession);
        setActiveViewState("outputs");
      } catch (caughtError) {
        setError(errorMessage(caughtError));
      } finally {
        setOperation(null);
      }
    },
    [session],
  );

  const approveAndExecute = useCallback(async () => {
    if (!session) {
      setError("Start a creative session before approving a direction.");
      return;
    }

    setError("");
    setOperation("approve");

    try {
      const approvedSession = await creativeApi.approve(session.session_id);
      setSession(approvedSession);

      setOperation("execute");
      const execution = await creativeApi.execute(approvedSession.session_id);
      setSession((currentSession) =>
        mergeExecution(currentSession, approvedSession.session_id, execution),
      );
    } catch (caughtError) {
      setError(errorMessage(caughtError));
    } finally {
      setOperation(null);
    }
  }, [session]);

  const retryExecute = useCallback(async () => {
    if (!session) {
      setError("Start a creative session before generating an artifact.");
      return;
    }

    if (session.status !== "approved" && session.status !== "executed") {
      setError("Approve a refined direction before generating an artifact.");
      return;
    }

    setError("");
    setOperation("execute");

    try {
      const execution = await creativeApi.execute(session.session_id);
      setSession((currentSession) => mergeExecution(currentSession, session.session_id, execution));
    } catch (caughtError) {
      setError(errorMessage(caughtError));
    } finally {
      setOperation(null);
    }
  }, [session]);

  const reset = useCallback(() => {
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
