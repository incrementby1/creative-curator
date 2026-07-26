import { describe, expect, it, vi } from "vitest";
import { loadViewport, saveViewport } from "./viewport-storage";

describe("viewport browser persistence", () => {
  it("loads only an exact finite bounded viewport", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ x: 12, y: -8, zoom: 1.5 })), removeItem: vi.fn() } as unknown as Storage;
    expect(loadViewport(storage, "viewport")).toEqual({ x: 12, y: -8, zoom: 1.5 });
    for (const value of [{ x: 1, y: 2, zoom: 1, extra: true }, { x: "1", y: 2, zoom: 1 }, { x: 1, y: 2, zoom: 9 }, { x: 1e9, y: 2, zoom: 1 }, "bad"]) {
      vi.mocked(storage.getItem).mockReturnValueOnce(JSON.stringify(value));
      expect(loadViewport(storage, "viewport")).toBeNull();
    }
  });

  it("never throws for SecurityError or QuotaExceededError", () => {
    const storage = { getItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
      setItem: vi.fn(() => { throw new DOMException("full", "QuotaExceededError"); }),
      removeItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }) } as unknown as Storage;
    expect(() => loadViewport(storage, "viewport")).not.toThrow();
    expect(() => saveViewport(storage, "viewport", { x: 0, y: 0, zoom: 1 })).not.toThrow();
    expect(saveViewport(storage, "viewport", { x: 0, y: 0, zoom: 1 })).toBe(false);
  });
});
