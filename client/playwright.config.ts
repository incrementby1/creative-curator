import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const clientDirectory = path.resolve(__dirname);
const backendDirectory = path.resolve(clientDirectory, "../backend");
const backendPython =
  process.env.BACKEND_PYTHON ??
  path.join(
    backendDirectory,
    process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
  );

function quoteCommandArgument(value: string): string {
  return process.platform === "win32"
    ? `"${value.replaceAll('"', '\\"')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        `${quoteCommandArgument(backendPython)} -m uvicorn app.main:app --host 127.0.0.1 --port 8100`,
      cwd: backendDirectory,
      port: 8100,
      reuseExistingServer: false,
      env: {
        APP_ENV: "test",
        AUTH_MODE: "test",
        SETTINGS_STORE_MODE: "memory",
        LLM_TRANSPORT_MODE: "test",
        BYOK_MASTER_KEY: "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=",
        SUPABASE_URL: "",
        SUPABASE_ANON_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
      },
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
      cwd: clientDirectory,
      port: 3100,
      reuseExistingServer: false,
      env: {
        BACKEND_URL: "http://127.0.0.1:8100",
        NEXT_PUBLIC_AUTH_MODE: "test",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      },
    },
  ],
});
