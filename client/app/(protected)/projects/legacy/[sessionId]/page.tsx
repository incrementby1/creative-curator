import { LegacySession } from "../../../../components/projects/legacy-session";

export default async function LegacySessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <LegacySession sessionId={sessionId} />;
}
