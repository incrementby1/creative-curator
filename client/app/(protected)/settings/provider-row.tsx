"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../lib/api-client";
import type { ProviderCatalogItem } from "../../lib/settings-api";
import { settingsApi } from "../../lib/settings-api";
import styles from "../../styles/settings.module.css";

function stateText(provider: ProviderCatalogItem): string {
  if (provider.state === "connected") return `Connected, key ending ${provider.masked_suffix}`;
  if (provider.state === "needs_attention") return `Needs attention, key ending ${provider.masked_suffix}`;
  return "Not connected";
}

export default function ProviderRow({
  provider,
  onChanged,
  routingUsage,
}: {
  provider: ProviderCatalogItem;
  onChanged: () => Promise<void>;
  routingUsage: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.configured_base_url ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [manualRequired, setManualRequired] = useState(provider.manual_model_entry);
  const [showKey, setShowKey] = useState(false);
  const [tested, setTested] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | "disconnect" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const actionRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const confirmDisconnectRef = useRef<HTMLButtonElement>(null);

  const connected = provider.state !== "not_connected";
  const canOverrideEndpoint = provider.requires_custom_base_url || provider.base_url_env_names.length > 0;

  function mutate(setter: (value: string) => void, value: string) {
    setter(value);
    setTested(false);
    setMessage("");
    setError("");
  }

  function clearDraft() {
    setApiKey("");
    setModel("");
    setBaseUrl("");
    setModels([]);
    setManualRequired(provider.manual_model_entry);
    setShowKey(false);
    setTested(false);
    setMessage("");
    setError("");
  }

  function startEditing() {
    setApiKey("");
    setModel("");
    setBaseUrl(provider.configured_base_url ?? "");
    setModels([]);
    setShowKey(false);
    setTested(false);
    setMessage("");
    setError("");
    setConfirming(false);
    setEditing(true);
  }

  async function testConnection() {
    if (!apiKey.trim() || !model.trim()) {
      setError("Enter an API key and model before testing.");
      return;
    }
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const access = { api_key: apiKey, base_url: baseUrl.trim() || null };
      await settingsApi.testProvider(provider.slug, { ...access, model: model.trim() });
      setTested(true);
      setMessage("Connection verified. Review the model, then save.");
      try {
        const discovery = await settingsApi.discoverModels(provider.slug, access);
        setModels(discovery.models);
        setManualRequired(discovery.manual_entry_required);
      } catch {
        setModels([]);
        setManualRequired(true);
        setMessage("Connection verified. Model list unavailable; enter a model manually.");
      }
    } catch (caught) {
      setTested(false);
      setError(caught instanceof ApiClientError ? caught.message : "Connection test failed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function saveConnection() {
    if (!tested) return;
    setBusy("save");
    setError("");
    try {
      await settingsApi.saveProvider(provider.slug, {
        api_key: apiKey,
        model: model.trim(),
        base_url: baseUrl.trim() || null,
      });
      clearDraft();
      setEditing(false);
      await onChanged();
    } catch (caught) {
      setTested(false);
      setError(caught instanceof ApiClientError ? caught.message : "Unable to save this connection.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    try {
      await settingsApi.disconnectProvider(provider.slug);
      clearDraft();
      setConfirming(false);
      setEditing(false);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to disconnect this provider.");
    } finally {
      setBusy(null);
    }
  }

  function cancelDisconnect() {
    setConfirming(false);
    requestAnimationFrame(() => disconnectRef.current?.focus());
  }

  useEffect(() => {
    if (confirming) confirmDisconnectRef.current?.focus();
  }, [confirming]);

  return (
    <article className={styles.providerRow}>
      <div className={styles.providerSummary}>
        <div className={styles.providerIdentity}>
          <h3>{provider.display_name}</h3>
          <p className={provider.state === "needs_attention" ? styles.dangerText : undefined}>
            {stateText(provider)}
          </p>
          <p className={styles.routingUsage}>{routingUsage}</p>
          {provider.configured_base_url && <small>{provider.configured_base_url}</small>}
        </div>
        <div className={styles.rowActions}>
          <button
            className={connected ? styles.secondaryButton : styles.primaryButton}
            disabled={busy === "disconnect"}
            onClick={() => {
              if (editing) {
                clearDraft();
                setEditing(false);
                setConfirming(false);
              } else {
                startEditing();
              }
            }}
            ref={actionRef}
            type="button"
          >
            {connected
              ? editing ? `Close ${provider.display_name} settings` : `Manage ${provider.display_name}`
              : editing ? `Close ${provider.display_name} connection` : `Connect ${provider.display_name}`}
          </button>
        </div>
      </div>

      {editing && (
        <div className={styles.providerEditor}>
          <div className={styles.editorHeading}>
            <h4>{connected ? "Replace saved key" : "Connect provider"}</h4>
            <p>{connected ? "Test a replacement before overwriting the saved key." : "Test this key before saving it."}</p>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${provider.slug}-key`}>{provider.display_name} API key</label>
            <div className={styles.secretInput}>
              <input
                autoComplete="off"
                disabled={busy === "disconnect"}
                id={`${provider.slug}-key`}
                onBlur={() => !apiKey.trim() && setError("API key is required.")}
                onChange={(event) => mutate(setApiKey, event.target.value)}
                spellCheck={false}
                type={showKey ? "text" : "password"}
                value={apiKey}
              />
              <button
                aria-label={`${showKey ? "Hide" : "Show"} key for ${provider.display_name}`}
                disabled={busy === "disconnect"}
                onClick={() => setShowKey((value) => !value)}
                type="button"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${provider.slug}-model`}>{provider.display_name} model</label>
            <input
              disabled={busy === "disconnect"}
              id={`${provider.slug}-model`}
              list={`${provider.slug}-models`}
              onBlur={() => !model.trim() && setError("Model is required.")}
              onChange={(event) => mutate(setModel, event.target.value)}
              placeholder="Enter a model name"
              value={model}
            />
            <datalist id={`${provider.slug}-models`}>
              {models.map((item) => <option key={item} value={item}>{item}</option>)}
            </datalist>
            {(manualRequired || provider.manual_model_entry) && <small>Manual model entry is available.</small>}
          </div>
          {canOverrideEndpoint && (
            <div className={styles.field}>
              <label htmlFor={`${provider.slug}-endpoint`}>
                {provider.display_name} endpoint {provider.requires_custom_base_url ? "" : "(optional)"}
              </label>
              <input
                disabled={busy === "disconnect"}
                id={`${provider.slug}-endpoint`}
                inputMode="url"
                onChange={(event) => mutate(setBaseUrl, event.target.value)}
                placeholder={provider.default_base_url ?? "https://provider.example/v1"}
                type="url"
                value={baseUrl}
              />
            </div>
          )}
          <div aria-live="polite" className={styles.inlineStatus}>
            {error && <p className={styles.dangerText} role="alert">{error}</p>}
            {message && <p className={styles.successText}>{message}</p>}
          </div>
          <div className={styles.editorActions}>
            <button
              className={styles.secondaryButton}
              disabled={busy !== null}
              onClick={() => void testConnection()}
              type="button"
            >
              {busy === "test" ? "Testing…" : `Test ${provider.display_name} connection`}
            </button>
            <button
              className={styles.primaryButton}
              disabled={!tested || busy !== null}
              onClick={() => void saveConnection()}
              type="button"
            >
              {busy === "save" ? "Saving…" : `Save ${provider.display_name} connection`}
            </button>
            <button
              className={styles.textButton}
              disabled={busy === "disconnect"}
              onClick={() => { clearDraft(); setEditing(false); }}
              type="button"
            >
              Cancel
            </button>
          </div>
          {connected && (
            <div className={styles.managementDanger}>
              {!confirming ? (
                <>
                  <div>
                    <strong>Disconnect provider</strong>
                    <p>Remove saved credential after clearing any routing references.</p>
                  </div>
                  <button
                    className={styles.dangerButton}
                    onClick={() => setConfirming(true)}
                    ref={disconnectRef}
                    type="button"
                  >Disconnect {provider.display_name}</button>
                </>
              ) : (
                <div className={styles.confirmation}>
                  <span>Remove this saved key?</span>
                  <button
                    aria-label={`Confirm disconnect ${provider.display_name}`}
                    className={styles.dangerButton}
                    disabled={busy === "disconnect"}
                    onClick={() => void disconnect()}
                    ref={confirmDisconnectRef}
                    type="button"
                  >
                    {busy === "disconnect" ? "Disconnecting…" : `Confirm disconnect ${provider.display_name}`}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy === "disconnect"}
                    onClick={cancelDisconnect}
                    type="button"
                  >
                    Cancel disconnect {provider.display_name}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {error && !editing && <p className={styles.rowError} role="alert">{error}</p>}
    </article>
  );
}
