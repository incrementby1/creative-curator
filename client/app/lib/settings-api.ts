import { authorizedJson } from "./api-client";

export type ProviderState = "not_connected" | "connected" | "needs_attention";

export type ProviderCatalogItem = {
  slug: string;
  display_name: string;
  key_names: string[];
  default_base_url: string | null;
  base_url_env_names: string[];
  requires_custom_base_url: boolean;
  model_discovery_supported: boolean;
  manual_model_entry: boolean;
  state: ProviderState;
  masked_suffix: string | null;
  configured_base_url: string | null;
  tested_at: string | null;
};

export type ProviderCatalog = { manifest_version: number; providers: ProviderCatalogItem[] };
export type RouteTarget = { provider_slug: string; model: string };
export type RoutingSettings = { primary: RouteTarget | null; fallbacks: RouteTarget[]; version: number };
export type ProviderAccess = { api_key: string | null; base_url: string | null };
export type ProviderDraft = ProviderAccess & { model: string };
export type ModelDiscovery = { models: string[]; manual_entry_required: boolean };

const json = (body: object) => JSON.stringify(body);

export const settingsApi = {
  catalog: () => authorizedJson<ProviderCatalog>("/api/settings/providers"),
  routing: () => authorizedJson<RoutingSettings>("/api/settings/routing"),
  testProvider: (slug: string, draft: ProviderDraft) =>
    authorizedJson<{ ok: true }>(`/api/settings/providers/${slug}/test`, {
      method: "POST",
      body: json(draft),
    }),
  discoverModels: (slug: string, access: ProviderAccess) =>
    authorizedJson<ModelDiscovery>(`/api/settings/providers/${slug}/models`, {
      method: "POST",
      body: json(access),
    }),
  saveProvider: (slug: string, draft: ProviderDraft & { api_key: string }) =>
    authorizedJson<ProviderCatalogItem>(`/api/settings/providers/${slug}`, {
      method: "PUT",
      body: json(draft),
    }),
  disconnectProvider: (slug: string) =>
    authorizedJson<void>(`/api/settings/providers/${slug}`, { method: "DELETE" }),
  saveRouting: (routing: RoutingSettings) =>
    authorizedJson<RoutingSettings>("/api/settings/routing", {
      method: "PUT",
      body: json(routing),
    }),
};
