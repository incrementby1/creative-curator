import Link from "next/link";
import { ProjectList } from "../../components/projects/project-list";
import styles from "../../styles/projects.module.css";

export default function ProjectsPage() {
  return <div className={styles.projectsPage}><header className={styles.pageHeader}><div><p className={styles.index}>Brand workspace</p><h1>Projects</h1><p>Living brand systems, evidence, decisions, and open challenges.</p></div><Link className={styles.primaryAction} href="/projects/new">Create project</Link></header><ProjectList /></div>;
}
