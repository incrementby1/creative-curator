import { BlueprintEntry } from "../../../../components/blueprint/blueprint-entry";
import "../../../../styles/print.css";

export default async function BlueprintPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <BlueprintEntry projectId={projectId} />;
}
