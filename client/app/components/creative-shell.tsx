"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/auth-provider";
import styles from "../page.module.css";
import BriefView from "./brief-view";
import DnaView from "./dna-view";
import OutputsView from "./outputs-view";
import {
  type WorkspaceView,
  WorkspaceProvider,
  useWorkspace,
} from "./workspace-context";

const NAV_ITEMS: Array<{
  id: WorkspaceView;
  label: string;
  detail: string;
  number: string;
}> = [
  { id: "brief", label: "Brief", detail: "Set the premise", number: "01" },
  { id: "dna", label: "DNA", detail: "Read the hypothesis", number: "02" },
  { id: "outputs", label: "Outputs", detail: "Choose the direction", number: "03" },
];

const STATUS_LABELS = {
  active: "Directions ready",
  refined_ready: "Refinement ready",
  approved: "Direction approved",
  executed: "Artifact complete",
} as const;

function MenuIcon({ open }: { open: boolean }) {
  return (
    <span className={`${styles.menuIcon} ${open ? styles.menuIconOpen : ""}`} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

function WorkspaceShell() {
  const { authError, signOut } = useAuth();
  const {
    activeView,
    error,
    errorStatus,
    operation,
    reset,
    session,
    setActiveView,
  } = useWorkspace();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const firstNavRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setMobileDrawer(query.matches);
      if (!query.matches) setDrawerOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobileDrawer || !drawerOpen) return;

    firstNavRef.current?.focus();
    const handleDrawerKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        requestAnimationFrame(() => menuRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDrawerKey);
    return () => document.removeEventListener("keydown", handleDrawerKey);
  }, [drawerOpen, mobileDrawer]);

  function closeDrawer() {
    const restoreFocus = mobileDrawer && drawerOpen;
    setDrawerOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => menuRef.current?.focus());
    }
  }

  function navigate(view: WorkspaceView) {
    setActiveView(view);
    closeDrawer();
  }

  const activeIndex = NAV_ITEMS.findIndex((item) => item.id === activeView);
  const modalOpen = mobileDrawer && drawerOpen;
  const progress = session?.status === "executed" ? 100 : session?.status === "refined_ready" || session?.status === "approved" ? 82 : session ? 58 : 16;
  const status = operation
    ? `${operation === "start" ? "Starting" : operation === "reject" ? "Refining" : operation === "approve" ? "Approving" : "Generating"}…`
    : session
      ? STATUS_LABELS[session.status]
      : "Ready for a brief";

  return (
    <main className={styles.appShell}>
      <header className={styles.appBar} inert={modalOpen ? true : undefined}>
        <button
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          className={styles.menuButton}
          onClick={() => setDrawerOpen((current) => !current)}
          ref={menuRef}
          type="button"
        >
          <MenuIcon open={drawerOpen} />
        </button>
        <button className={styles.wordmark} onClick={() => navigate("brief")} type="button">
          Creative Curator
        </button>
        <div className={styles.headerStatus}>
          <span>{status}</span>
          <i aria-hidden="true"><b style={{ width: `${progress}%` }} /></i>
          <button className={styles.signOutButton} onClick={() => void signOut()} type="button">
            Sign out
          </button>
          {authError && <span className={styles.authError} role="alert">{authError}</span>}
        </div>
      </header>

      <div
        aria-hidden="true"
        className={`${styles.drawerScrim} ${modalOpen ? styles.drawerScrimOpen : ""}`}
        data-drawer-backdrop
        onClick={closeDrawer}
        role="presentation"
      />

      <aside
        aria-label="Primary navigation"
        aria-hidden={mobileDrawer && !drawerOpen}
        aria-modal={modalOpen ? "true" : undefined}
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
        inert={mobileDrawer && !drawerOpen ? true : undefined}
        ref={drawerRef}
        role={modalOpen ? "dialog" : undefined}
      >
        <div className={styles.drawerIntro}>
          <span>Hermes workspace</span>
          <p>One brief.<br />Three routes.<br />One clear answer.</p>
        </div>

        <nav>
          {NAV_ITEMS.map((item) => {
            const disabled = item.id !== "brief" && !session;
            return (
              <button
                aria-current={activeView === item.id ? "page" : undefined}
                className={activeView === item.id ? styles.activeNavItem : ""}
                disabled={disabled}
                key={item.id}
                onClick={() => navigate(item.id)}
                ref={item.id === "brief" ? firstNavRef : undefined}
                type="button"
              >
                <small>{item.number}</small>
                <span>
                  <strong>{item.label}</strong>
                  <em>{item.detail}</em>
                </span>
                <i aria-hidden="true">{disabled ? "—" : "↗"}</i>
              </button>
            );
          })}
        </nav>

        <div className={styles.drawerFooter}>
          <span>Session</span>
          <p>{session ? session.brand_name : "Waiting for a starting point"}</p>
        </div>
      </aside>

      <div className={styles.appContent} inert={modalOpen ? true : undefined}>
        <div className={styles.progressRail} aria-label={`Step ${activeIndex + 1} of 3`}>
          {NAV_ITEMS.map((item, index) => (
            <span className={index <= activeIndex ? styles.progressActive : ""} key={item.id} />
          ))}
        </div>
        <div hidden={activeView !== "brief"}>
          <BriefView />
        </div>
        <div hidden={activeView !== "dna"}>
          <DnaView />
        </div>
        <div hidden={activeView !== "outputs"}>
          <OutputsView key={session?.session_id ?? "empty-session"} />
        </div>
        <div className={styles.globalStatus} role="status" aria-live="polite">
          {error && (
            <div>
              <p>{error}</p>
              {errorStatus === 404 && (
                <button className={styles.textButton} onClick={reset} type="button">
                  Start over
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function CreativeShell() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
