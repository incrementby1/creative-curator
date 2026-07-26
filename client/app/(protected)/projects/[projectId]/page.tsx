import { ProjectEntry } from "../../../components/constellation/project-entry";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectEntry projectId={projectId} />;
}
