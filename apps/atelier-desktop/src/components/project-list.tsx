import { Folder } from "lucide-react";

import type { ProjectInfo } from "../lib/types";
import { useProjects } from "../hooks/use-projects";
import { useSessionStore } from "../store/session-store";
import { EmptyProject } from "./empty-states";
import { ProjectListSkeleton } from "./skeletons";

export function ProjectList() {
  const { data: projects, isLoading, error } = useProjects();
  const { selectedProject, setSelectedProject } = useSessionStore();

  if (isLoading) {
    return <ProjectListSkeleton />;
  }

  if (error) {
    return (
      <div className="text-destructive p-4 text-sm">
        Error loading projects: {error.message}
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return <EmptyProject />;
  }

  return (
    <div className="space-y-1 overflow-auto p-2">
      {projects.map((project) => (
        <ProjectItem
          key={project.escapedPath}
          project={project}
          isSelected={selectedProject?.escapedPath === project.escapedPath}
          onClick={() => setSelectedProject(project)}
        />
      ))}
    </div>
  );
}

interface ProjectItemProps {
  project: ProjectInfo;
  isSelected: boolean;
  onClick: () => void;
}

function ProjectItem({ project, isSelected, onClick }: ProjectItemProps) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      }`}
    >
      <Folder className="text-muted-foreground h-4 w-4 shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{project.name}</div>
        <div className="text-muted-foreground truncate text-xs">
          {project.path}
        </div>
      </div>

      <div className="bg-primary text-primary-foreground flex shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium">
        {project.sessionCount}
      </div>
    </button>
  );
}
