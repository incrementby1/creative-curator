"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "./auth/auth-provider";
import { type WorkspaceView, useWorkspace } from "./workspace-context";
import styles from "../styles/shell.module.css";

const WORKSPACE_NAV: Array<{ id: WorkspaceView; label: string; detail: string; number: string }> = [
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
  return <span className={`${styles.menuIcon} ${open ? styles.menuIconOpen : ""}`} aria-hidden="true"><i /><i /></span>;
}

export default function CreativeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authError, client, ready, signOut } = useAuth();
  const { activeView, error, errorCode, errorStatus, operation, reset, session, setActiveView } = useWorkspace();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const firstNavRef = useRef<HTMLButtonElement>(null);
  const firstDestinationRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const restoreMenuFocusRef = useRef(false);
  const workspaceRoute = pathname === "/";

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
    (firstNavRef.current ?? firstDestinationRef.current)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        restoreMenuFocusRef.current = true;
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
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
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [drawerOpen, mobileDrawer]);

  useLayoutEffect(() => {
    if (drawerOpen || !restoreMenuFocusRef.current) return;
    restoreMenuFocusRef.current = false;
    menuRef.current?.focus();
  }, [drawerOpen]);

  function closeDrawer(restore = true) {
    const shouldRestore = restore && mobileDrawer && drawerOpen;
    if (shouldRestore) restoreMenuFocusRef.current = true;
    setDrawerOpen(false);
  }

  function openWorkspace(view: WorkspaceView) {
    setActiveView(view);
    if (!workspaceRoute) router.push("/");
    closeDrawer();
  }

  function handleSignOut() {
    closeDrawer();
    void signOut();
  }

  const modalOpen = mobileDrawer && drawerOpen;
  const progress = session?.status === "executed" ? 100 : session?.status === "refined_ready" || session?.status === "approved" ? 82 : session ? 58 : 16;
  const status = operation
    ? `${operation === "start" ? "Starting" : operation === "reject" ? "Refining" : operation === "approve" ? "Approving" : "Generating"}…`
    : session ? STATUS_LABELS[session.status] : "Ready for a brief";

  return (
    <main className={styles.appShell}>
      <a
        aria-hidden={modalOpen ? "true" : undefined}
        className={styles.skipLink}
        href="#main-content"
        inert={modalOpen ? true : undefined}
        tabIndex={modalOpen ? -1 : undefined}
      >Skip to main content</a>
      <header className={styles.appBar} inert={modalOpen ? true : undefined}>
        {mobileDrawer && (
          <button
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            className={styles.menuButton}
            onClick={() => setDrawerOpen((current) => !current)}
            ref={menuRef}
            type="button"
          ><MenuIcon open={drawerOpen} /></button>
        )}
        <button className={styles.wordmark} onClick={() => openWorkspace("brief")} type="button">
          Creative Curator
        </button>
        {!mobileDrawer && (
          <nav aria-label="Main navigation" className={styles.topNavigation}>
            <Link aria-current={workspaceRoute ? "page" : undefined} href="/">Workspace</Link>
            <Link aria-current={pathname === "/settings" ? "page" : undefined} href="/settings">Settings</Link>
            <button className={styles.signOutButton} disabled={!ready || !client} onClick={handleSignOut} type="button">Sign out</button>
          </nav>
        )}
        {workspaceRoute && (
          <div className={styles.headerStatus}>
            <span>{status}</span>
            <i aria-hidden="true"><b style={{ width: `${progress}%` }} /></i>
          </div>
        )}
        {authError && <span className={styles.authError} role="alert">{authError}</span>}
      </header>

      {(workspaceRoute || mobileDrawer) && (
        <>
          <div aria-hidden="true" className={`${styles.drawerScrim} ${modalOpen ? styles.drawerScrimOpen : ""}`} data-drawer-backdrop onClick={() => closeDrawer()} role="presentation" />
          <aside
            aria-label="Primary navigation"
            aria-hidden={mobileDrawer && !drawerOpen}
            aria-modal={modalOpen ? "true" : undefined}
            className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
            inert={mobileDrawer && !drawerOpen ? true : undefined}
            ref={drawerRef}
            role={modalOpen ? "dialog" : undefined}
          >
            {workspaceRoute && (
              <>
                <div className={styles.drawerIntro}><strong>Workspace</strong><p>Move from brief to decision without losing context.</p></div>
                <nav aria-label="Workspace views">
                  {WORKSPACE_NAV.map((item) => {
                    const disabled = item.id !== "brief" && !session;
                    return (
                      <button
                        aria-current={activeView === item.id ? "step" : undefined}
                        className={activeView === item.id ? styles.activeNavItem : ""}
                        disabled={disabled}
                        key={item.id}
                        onClick={() => openWorkspace(item.id)}
                        ref={item.id === "brief" ? firstNavRef : undefined}
                        type="button"
                      >
                        <small>{item.number}</small><span><strong>{item.label}</strong><em>{item.detail}</em></span>
                      </button>
                    );
                  })}
                </nav>
              </>
            )}
            {mobileDrawer && <div className={styles.mobileDestinations}>
              <Link href="/" onClick={() => closeDrawer()} ref={firstDestinationRef}>Workspace</Link>
              <Link href="/settings" onClick={() => closeDrawer()}>Settings</Link>
              <button disabled={!ready || !client} onClick={handleSignOut} type="button">Sign out</button>
            </div>}
            {workspaceRoute && <div className={styles.drawerFooter}><strong>Session</strong><p>{session ? session.brand_name : "Waiting for a starting point"}</p></div>}
          </aside>
        </>
      )}

      <div
        className={`${styles.appContent} ${workspaceRoute ? styles.workspaceContent : styles.routeContent}`}
        id="main-content"
        inert={modalOpen ? true : undefined}
        tabIndex={-1}
      >
        {children}
        {workspaceRoute && (
          <div className={styles.globalStatus} role="status" aria-live="polite">
            {error && (
              <div>
                <p>{error}</p>
                {errorStatus === 404 && <button onClick={reset} type="button">Start over</button>}
                {errorCode === "ai_configuration_required" && <Link href="/settings">Open Settings</Link>}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
