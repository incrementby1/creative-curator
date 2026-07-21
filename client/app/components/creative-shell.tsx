"use client";

import { useState } from "react";
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
  const { activeView, error, operation, session, setActiveView } = useWorkspace();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function navigate(view: WorkspaceView) {
    setActiveView(view);
    setDrawerOpen(false);
  }

  const activeIndex = NAV_ITEMS.findIndex((item) => item.id === activeView);
  const progress = session?.status === "executed" ? 100 : session?.status === "refined_ready" || session?.status === "approved" ? 82 : session ? 58 : 16;
  const status = operation
    ? `${operation === "start" ? "Starting" : operation === "reject" ? "Refining" : operation === "approve" ? "Approving" : "Generating"}…`
    : session
      ? STATUS_LABELS[session.status]
      : "Ready for a brief";

  return (
    <main className={styles.appShell}>
      <header className={styles.appBar}>
        <button
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          className={styles.menuButton}
          onClick={() => setDrawerOpen((current) => !current)}
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
        </div>
      </header>

      <button
        aria-hidden={!drawerOpen}
        className={`${styles.drawerScrim} ${drawerOpen ? styles.drawerScrimOpen : ""}`}
        onClick={() => setDrawerOpen(false)}
        tabIndex={drawerOpen ? 0 : -1}
        type="button"
      />

      <aside
        aria-label="Primary navigation"
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
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

      <div className={styles.appContent}>
        <div className={styles.progressRail} aria-label={`Step ${activeIndex + 1} of 3`}>
          {NAV_ITEMS.map((item, index) => (
            <span className={index <= activeIndex ? styles.progressActive : ""} key={item.id} />
          ))}
        </div>
        {activeView === "brief" && <BriefView />}
        {activeView === "dna" && <DnaView />}
        {activeView === "outputs" && <OutputsView />}
        <div className={styles.globalStatus} role="status" aria-live="polite">
          {error && <p>{error}</p>}
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
