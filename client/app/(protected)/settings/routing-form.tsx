"use client";

import { useState } from "react";
import { ApiClientError } from "../../lib/api-client";
import type { ProviderCatalogItem, RouteTarget, RoutingSettings } from "../../lib/settings-api";
import { settingsApi } from "../../lib/settings-api";
import styles from "../../styles/settings.module.css";

const EMPTY_TARGET: RouteTarget = { provider_slug: "", model: "" };

export default function RoutingForm({
  providers,
  routing,
  onRoutingChange,
}: {
  providers: ProviderCatalogItem[];
  routing: RoutingSettings;
  onRoutingChange: (routing: RoutingSettings) => void;
}) {
  const [primary, setPrimary] = useState<RouteTarget | null>(routing.primary);
  const [fallbacks, setFallbacks] = useState<RouteTarget[]>(routing.fallbacks);
  const [version, setVersion] = useState(routing.version);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const connected = providers.filter((provider) => provider.state === "connected");
  const connectedSlugs = new Set(connected.map((provider) => provider.slug));
  const names = new Map(providers.map((provider) => [provider.slug, provider.display_name]));
  const hasSavedRouting = routing.primary !== null || routing.fallbacks.length > 0;
  const unavailablePrimary = primary && !connectedSlugs.has(primary.provider_slug)
    ? providers.find((provider) => provider.slug === primary.provider_slug)
    : null;

  function unavailableLabel(slug: string): string {
    const provider = providers.find((item) => item.slug === slug);
    if (!provider) return `${slug} (unavailable)`;
    return provider.state === "needs_attention"
      ? `${provider.display_name} (needs attention)`
      : `${provider.display_name} (not connected)`;
  }

  function updatePrimaryProvider(slug: string) {
    setPrimary(slug ? { provider_slug: slug, model: "" } : null);
    if (!slug) setFallbacks([]);
    setMessage("");
    setError("");
  }

  function updateFallback(index: number, update: Partial<RouteTarget>) {
    setFallbacks((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...update } : item,
    ));
    setMessage("");
    setError("");
  }

  function move(index: number, delta: -1 | 1) {
    setFallbacks((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setMessage("");
  }

  function isValid(): boolean {
    if (!primary) return fallbacks.length === 0 && hasSavedRouting;
    return connectedSlugs.has(primary.provider_slug)
      && Boolean(primary.model.trim())
      && fallbacks.every(
      (item) => connectedSlugs.has(item.provider_slug) && Boolean(item.model.trim()),
      )
      && !duplicateValidation();
  }

  function duplicateValidation(): string {
    if (!primary) return "";
    const primaryKey = JSON.stringify([primary.provider_slug, primary.model.trim()]);
    const fallbackKeys = fallbacks
      .filter((item) => item.provider_slug && item.model.trim())
      .map((item) => JSON.stringify([item.provider_slug, item.model.trim()]));
    if (primary.provider_slug && primary.model.trim() && fallbackKeys.includes(primaryKey)) {
      return "Primary route cannot also be an exact fallback.";
    }
    if (new Set(fallbackKeys).size !== fallbackKeys.length) {
      return "Fallback routes must be unique by provider and model.";
    }
    return "";
  }

  async function save() {
    if (!isValid()) {
      setError("Choose a connected provider and enter a model for every route.");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await settingsApi.saveRouting({
        primary: primary ? { ...primary, model: primary.model.trim() } : null,
        fallbacks: fallbacks.map((item) => ({ ...item, model: item.model.trim() })),
        version,
      });
      setPrimary(saved.primary);
      setFallbacks(saved.fallbacks);
      setVersion(saved.version);
      onRoutingChange(saved);
      setMessage("Routing saved.");
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "settings_version_conflict") {
        try {
          const latest = await settingsApi.routing();
          setPrimary(latest.primary);
          setFallbacks(latest.fallbacks);
          setVersion(latest.version);
          onRoutingChange(latest);
          setError("Settings changed elsewhere. Latest routing loaded.");
        } catch {
          setError("Settings changed elsewhere. Reload the page before saving again.");
        }
      } else {
        setError(caught instanceof ApiClientError ? caught.message : "Unable to save routing.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.routingForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {connected.length === 0 && (
        <p className={styles.emptyState}>Connect at least one provider before setting model routing.</p>
      )}
      <div className={styles.primaryRoute}>
        <div className={styles.field}>
          <label htmlFor="primary-provider">Primary provider</label>
          <select
            disabled={connected.length === 0 && !hasSavedRouting}
            id="primary-provider"
            onChange={(event) => updatePrimaryProvider(event.target.value)}
            value={primary?.provider_slug ?? ""}
          >
            <option value="">No primary provider</option>
            {unavailablePrimary && (
              <option disabled value={unavailablePrimary.slug}>
                {unavailableLabel(unavailablePrimary.slug)}
              </option>
            )}
            {connected.map((provider) => (
              <option key={provider.slug} value={provider.slug}>{provider.display_name}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="primary-model">Primary model</label>
          <input
            disabled={!primary}
            id="primary-model"
            onChange={(event) => {
              if (primary) setPrimary({ ...primary, model: event.target.value });
              setMessage("");
              setError("");
            }}
            placeholder="Enter model name"
            value={primary?.model ?? ""}
          />
        </div>
      </div>

      <div className={styles.fallbackHeading}>
        <div>
          <h3>Fallback order</h3>
          <p>Routes run from top to bottom if the primary provider fails.</p>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={!primary || fallbacks.length >= 5}
          onClick={() => setFallbacks((current) => [...current, { ...EMPTY_TARGET }])}
          type="button"
        >
          Add fallback
        </button>
      </div>

      <ol className={styles.fallbackList}>
        {fallbacks.map((fallback, index) => {
          const displayName = names.get(fallback.provider_slug) ?? `Fallback ${index + 1}`;
          return (
            <li data-testid="fallback-row" key={`${index}-${fallback.provider_slug}`}>
              <span aria-hidden="true" className={styles.orderNumber}>{index + 1}</span>
              <div className={styles.field}>
                <label htmlFor={`fallback-provider-${index}`}>Provider</label>
                <select
                  id={`fallback-provider-${index}`}
                  onChange={(event) => updateFallback(index, { provider_slug: event.target.value, model: "" })}
                  value={fallback.provider_slug}
                >
                  <option value="">Choose provider</option>
                  {!connectedSlugs.has(fallback.provider_slug) && fallback.provider_slug && (
                    <option disabled value={fallback.provider_slug}>
                      {unavailableLabel(fallback.provider_slug)}
                    </option>
                  )}
                  {connected.map((provider) => (
                    <option key={provider.slug} value={provider.slug}>{provider.display_name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor={`fallback-model-${index}`}>Model</label>
                <input
                  id={`fallback-model-${index}`}
                  onChange={(event) => updateFallback(index, { model: event.target.value })}
                  placeholder="Enter model name"
                  value={fallback.model}
                />
              </div>
              <div className={styles.orderActions}>
                <button
                  aria-label={`Move ${displayName} up`}
                  className={styles.iconButton}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  type="button"
                >Up</button>
                <button
                  aria-label={`Move ${displayName} down`}
                  className={styles.iconButton}
                  disabled={index === fallbacks.length - 1}
                  onClick={() => move(index, 1)}
                  type="button"
                >Down</button>
                <button
                  aria-label={`Remove ${displayName}`}
                  className={styles.textButton}
                  onClick={() => setFallbacks((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  type="button"
                >Remove</button>
              </div>
            </li>
          );
        })}
      </ol>

      <div aria-live="polite" className={styles.routingActions}>
        <button
          className={styles.primaryButton}
          disabled={saving || !isValid()}
          type="submit"
        >
          {saving ? "Saving…" : "Save routing"}
        </button>
        {message && <p className={styles.successText}>{message}</p>}
        {duplicateValidation() && <p className={styles.dangerText}>{duplicateValidation()}</p>}
        {error && <p className={styles.dangerText} role="alert">{error}</p>}
      </div>
    </form>
  );
}
