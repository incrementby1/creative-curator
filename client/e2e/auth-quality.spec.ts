import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("proxy matcher includes protected routes while session guard no-ops elsewhere", () => {
  const proxySource = readFileSync(path.resolve(__dirname, "../proxy.ts"), "utf8");
  const sessionGuardSource = readFileSync(path.resolve(__dirname, "../app/lib/supabase/proxy.ts"), "utf8");

  expect(proxySource).toContain(
    'matcher: ["/settings/:path*", "/projects/:path*"]',
  );
  expect(proxySource).not.toMatch(/matcher:\s*\[[^\]]*["']\/["']/);
  expect(proxySource).not.toContain("/login/:path*");
  expect(proxySource).not.toContain("/api/:path*");
  expect(sessionGuardSource).not.toContain('pathname === "/studio"');
  expect(sessionGuardSource).toContain('pathname === "/settings"');
  expect(sessionGuardSource).toContain('pathname.startsWith("/settings/")');
  expect(sessionGuardSource).toContain('pathname === "/projects"');
  expect(sessionGuardSource).toContain('pathname.startsWith("/projects/")');
});
