import SettingsClient from "./settings-client";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const raw = (await searchParams).returnTo; const candidate = typeof raw === "string" ? raw : null;
  const returnTo = candidate && candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\") ? candidate : null;
  return <SettingsClient returnTo={returnTo} />;
}
