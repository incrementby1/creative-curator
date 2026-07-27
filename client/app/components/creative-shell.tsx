"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "./auth/auth-provider";
import styles from "../styles/shell.module.css";

function MenuIcon({ open }: { open: boolean }) {
  return <span className={`${styles.menuIcon} ${open ? styles.menuIconOpen : ""}`} aria-hidden="true"><i /><i /></span>;
}

export default function CreativeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authError, client, ready, signOut, user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [currentProject, setCurrentProject] = useState<{ id: string; title: string } | null>(null);
  const firstDestinationRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const restoreMenuFocusRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      try {
        const value = localStorage.getItem(`creative-curator:current-project:${user.id}`);
        setCurrentProject(value ? JSON.parse(value) as { id: string; title: string } : null);
      } catch { setCurrentProject(null); }
    };
    load();
    window.addEventListener("creative-curator:current-project", load);
    return () => window.removeEventListener("creative-curator:current-project", load);
  }, [user]);

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
    firstDestinationRef.current?.focus();
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
    if (restore && mobileDrawer && drawerOpen) restoreMenuFocusRef.current = true;
    setDrawerOpen(false);
  }

  function handleSignOut() {
    closeDrawer();
    void signOut();
  }

  const modalOpen = mobileDrawer && drawerOpen;

  return (
    <main className={styles.appShell}>
      <a aria-hidden={modalOpen ? "true" : undefined} className={styles.skipLink} href="#main-content" inert={modalOpen ? true : undefined} tabIndex={modalOpen ? -1 : undefined}>Skip to main content</a>
      <header className={styles.appBar} data-print-hidden="true" inert={modalOpen ? true : undefined}>
        {mobileDrawer && <button aria-expanded={drawerOpen} aria-label={drawerOpen ? "Close navigation" : "Open navigation"} className={styles.menuButton} onClick={() => setDrawerOpen((current) => !current)} ref={menuRef} type="button"><MenuIcon open={drawerOpen} /></button>}
        <Link className={styles.wordmark} href="/projects">Creative Curator</Link>
        {!mobileDrawer && <nav aria-label="Main navigation" className={styles.topNavigation}>
          <Link aria-current={pathname === "/projects" || pathname === "/projects/new" ? "page" : undefined} href="/projects">Projects</Link>
          {currentProject && <Link aria-current={pathname === `/projects/${currentProject.id}` ? "page" : undefined} href={`/projects/${currentProject.id}`}>{currentProject.title}</Link>}
          {currentProject && <Link aria-current={pathname === `/projects/${currentProject.id}/blueprint` ? "page" : undefined} href={`/projects/${currentProject.id}/blueprint`}>Blueprint</Link>}
          <Link aria-current={pathname === "/settings" ? "page" : undefined} href="/settings">Settings</Link>
          <button className={styles.signOutButton} disabled={!ready || !client} onClick={handleSignOut} type="button">Sign out</button>
        </nav>}
        {authError && <span className={styles.authError} role="alert">{authError}</span>}
      </header>

      {mobileDrawer && <>
        <div aria-hidden="true" className={`${styles.drawerScrim} ${modalOpen ? styles.drawerScrimOpen : ""}`} data-drawer-backdrop data-print-hidden="true" onClick={() => closeDrawer()} role="presentation" />
        <aside aria-label="Primary navigation" aria-hidden={!drawerOpen} aria-modal={modalOpen ? "true" : undefined} className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`} data-print-hidden="true" inert={!drawerOpen ? true : undefined} ref={drawerRef} role="dialog">
          <div className={styles.mobileDestinations}>
            <Link href="/projects" onClick={() => closeDrawer()} ref={firstDestinationRef}>Projects</Link>
            {currentProject && <Link href={`/projects/${currentProject.id}`} onClick={() => closeDrawer()}>{currentProject.title}</Link>}
            {currentProject && <Link href={`/projects/${currentProject.id}/blueprint`} onClick={() => closeDrawer()}>Blueprint</Link>}
            <Link href="/settings" onClick={() => closeDrawer()}>Settings</Link>
            <button disabled={!ready || !client} onClick={handleSignOut} type="button">Sign out</button>
          </div>
        </aside>
      </>}

      <div className={`${styles.appContent} ${styles.routeContent}`} id="main-content" inert={modalOpen ? true : undefined} tabIndex={-1}>{children}</div>
    </main>
  );
}
