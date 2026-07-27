import CreativeShell from "../components/creative-shell";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <CreativeShell>{children}</CreativeShell>;
}
