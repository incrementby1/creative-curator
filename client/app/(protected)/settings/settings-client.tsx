"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../components/auth/auth-provider";
import type { ProviderCatalog, RoutingSettings } from "../../lib/settings-api";
import { settingsApi } from "../../lib/settings-api";
import styles from "../../styles/settings.module.css";
import ProviderRow from "./provider-row";
import RoutingForm from "./routing-form";

export default function SettingsClient() {
  const { authError, signOut } = useAuth();
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [routing, setRouting] = useState<RoutingSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [providerFilter, setProviderFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextCatalog, nextRouting] = await Promise.all([
        settingsApi.catalog(),
        settingsApi.routing(),
      ]);
      setLoadError("");
      setCatalog(nextCatalog);
      setRouting(nextRouting);
    } catch {
      setLoadError("Unable to load settings. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([settingsApi.catalog(), settingsApi.routing()])
      .then(([nextCatalog, nextRouting]) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setRouting(nextRouting);
        setLoadError("");
      })
      .catch(() => {
        if (active) setLoadError("Unable to load settings. Check your connection and try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const normalizedFilter = providerFilter.trim().toLowerCase();
  const visibleProviders = catalog?.providers.filter((provider) =>
    !normalizedFilter
    || provider.display_name.toLowerCase().includes(normalizedFilter)
    || provider.slug.toLowerCase().includes(normalizedFilter)
  ) ?? [];

  function routingUsage(providerSlug: string): string {
    if (routing?.primary?.provider_slug === providerSlug) {
      return `Primary · ${routing.primary.model}`;
    }
    const fallbackIndex = routing?.fallbacks.findIndex(
      (target) => target.provider_slug === providerSlug,
    ) ?? -1;
    if (fallbackIndex >= 0 && routing) {
      return `Fallback ${fallbackIndex + 1} · ${routing.fallbacks[fallbackIndex].model}`;
    }
    return "Not used in routing";
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/">Creative Curator</Link>
        <nav aria-label="Account navigation" className={styles.navigation}>
          <Link href="/">Workspace</Link>
          <Link aria-current="page" href="/settings">Settings</Link>
          <button onClick={() => void signOut()} type="button">Sign out</button>
        </nav>
      </header>

      <div className={styles.content}>
        <div className={styles.intro}>
          <p>Account settings</p>
          <h1>AI provider settings</h1>
          <span>Connect your own provider keys, then choose how Creative Curator routes work.</span>
        </div>

        {(authError || loadError) && (
          <div className={styles.error} role="alert">
            <span>{authError || loadError}</span>
            {loadError && <button onClick={() => void load()} type="button">Try again</button>}
          </div>
        )}

        {loading && <p aria-live="polite" className={styles.loading}>Loading settings…</p>}
        {!loading && catalog && routing && (
          <>
            <section aria-labelledby="providers-heading" className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="providers-heading">Provider connections</h2>
                  <p>Keys stay masked after saving. Reconnect any provider that needs attention.</p>
                </div>
                <span>{catalog.providers.filter((item) => item.state === "connected").length} connected</span>
              </div>
              <div className={styles.providerTools}>
                <div className={styles.field}>
                  <label htmlFor="provider-filter">Filter providers</label>
                  <input
                    id="provider-filter"
                    onChange={(event) => setProviderFilter(event.target.value)}
                    placeholder="Search by provider name"
                    type="search"
                    value={providerFilter}
                  />
                </div>
                <span aria-live="polite">
                  {visibleProviders.length} {visibleProviders.length === 1 ? "provider" : "providers"} shown
                </span>
              </div>
              <div className={styles.providerList}>
                {visibleProviders.map((provider) => (
                  <ProviderRow
                    key={provider.slug}
                    onChanged={load}
                    provider={provider}
                    routingUsage={routingUsage(provider.slug)}
                  />
                ))}
                {visibleProviders.length === 0 && (
                  <div className={styles.filterEmpty}>
                    <p>No providers match this filter.</p>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => setProviderFilter("")}
                      type="button"
                    >Clear provider filter</button>
                  </div>
                )}
              </div>
            </section>

            <section aria-labelledby="routing-heading" className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="routing-heading">Model routing</h2>
                  <p>Choose one primary route and up to five fallbacks in retry order.</p>
                </div>
              </div>
              <RoutingForm
                onRoutingChange={setRouting}
                providers={catalog.providers}
                routing={routing}
              />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
