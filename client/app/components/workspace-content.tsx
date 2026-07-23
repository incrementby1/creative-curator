"use client";

import BriefView from "./brief-view";
import DnaView from "./dna-view";
import OutputsView from "./outputs-view";
import { useWorkspace } from "./workspace-context";
import styles from "../styles/shell.module.css";

const VIEW_ORDER = ["brief", "dna", "outputs"] as const;

export default function WorkspaceContent() {
  const { activeView, session } = useWorkspace();
  const activeIndex = VIEW_ORDER.indexOf(activeView);

  return (
    <>
      <div className={styles.progressRail} aria-label={`Step ${activeIndex + 1} of 3`}>
        {VIEW_ORDER.map((view, index) => (
          <span className={index <= activeIndex ? styles.progressActive : ""} key={view} />
        ))}
      </div>
      <div hidden={activeView !== "brief"}><BriefView /></div>
      <div hidden={activeView !== "dna"}><DnaView /></div>
      <div hidden={activeView !== "outputs"}>
        <OutputsView key={session?.session_id ?? "empty-session"} />
      </div>
    </>
  );
}
