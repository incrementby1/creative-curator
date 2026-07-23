import CreativeShell from "../components/creative-shell";
import { WorkspaceProvider } from "../components/workspace-context";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <CreativeShell>{children}</CreativeShell>
    </WorkspaceProvider>
  );
}
