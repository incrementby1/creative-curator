import type { Viewport } from "./annotation-layer";

const MAX_OFFSET = 1_000_000;
const exactViewport = (value: unknown): value is Viewport => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join(",") === "x,y,zoom" &&
    typeof item.x === "number" && Number.isFinite(item.x) && Math.abs(item.x) <= MAX_OFFSET &&
    typeof item.y === "number" && Number.isFinite(item.y) && Math.abs(item.y) <= MAX_OFFSET &&
    typeof item.zoom === "number" && Number.isFinite(item.zoom) && item.zoom >= 0.1 && item.zoom <= 4;
};

const remove = (storage: Storage, key: string) => { try { storage.removeItem(key); } catch { /* optional persistence */ } };

export function loadViewport(storage: Storage | null, key: string): Viewport | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!exactViewport(value)) { remove(storage, key); return null; }
    return value;
  } catch { remove(storage, key); return null; }
}

export function saveViewport(storage: Storage | null, key: string, viewport: Viewport): boolean {
  if (!storage || !exactViewport(viewport)) return false;
  try { storage.setItem(key, JSON.stringify(viewport)); return true; }
  catch { remove(storage, key); return false; }
}
