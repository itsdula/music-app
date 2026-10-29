import type { ProjectId } from '@studio/domain';
import type { ProjectSummary } from '@studio/project-storage';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@studio/ui';
import {
  AudioWaveform,
  ChevronDown,
  FilePlus2,
  LayoutGrid,
  FolderOpen,
  PackageOpen,
  Save,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useProjectState, useSession } from '../../session/context';
import { navigate } from '../../state/ui-store';

export function ProjectMenu() {
  const session = useSession();
  const name = useProjectState((s) => s.project.name);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [editing, setEditing] = useState(false);

  const report = (error: unknown) =>
    session.engineStore.setState({
      lastError: {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      },
    });

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void session.projects.list().then(setProjects, report);
        }}
      >
        <DropdownMenuTrigger
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-text hover:bg-surface-3"
          aria-label="Project menu"
          data-testid="project-menu"
        >
          <AudioWaveform className="size-4 text-accent" aria-hidden />
          Studio
          <ChevronDown className="size-3.5 text-text-muted" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuItem
            icon={<LayoutGrid />}
            data-testid="menu-all-projects"
            onSelect={() => session.uiStore.setState((s) => navigate(s, 'projects'))}
          >
            All projects…
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<FilePlus2 />}
            onSelect={() => void session.projects.newProject('empty').catch(report)}
          >
            New project
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Sparkles />}
            onSelect={() => void session.projects.newProject('demo').catch(report)}
          >
            New demo project
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderOpen className="size-4 text-text-muted" aria-hidden />
              Open recent
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              {projects.length === 0 && <DropdownMenuLabel>No saved projects</DropdownMenuLabel>}
              {projects.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() => void session.projects.open(p.id as ProjectId).catch(report)}
                >
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-[10px] text-text-faint">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<PackageOpen />}
            onSelect={() =>
              void (async () => {
                const [file] = await session.platform.fileDialogs.openFiles({
                  accept: ['.studio', 'application/zip'],
                  multiple: false,
                });
                if (file) await session.projects.importBundle(file);
              })().catch(report)
            }
          >
            Import project bundle…
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Save />}
            onSelect={() => void session.projects.exportBundle().catch(report)}
          >
            Export project bundle…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing ? (
        <input
          className="h-7 w-48 rounded-md border border-accent bg-surface-0 px-2 text-[13px] outline-none"
          defaultValue={name}
          aria-label="Project name"
          autoFocus
          onBlur={(e) => {
            session.projects.rename(e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="h-7 max-w-56 truncate rounded-md px-2 text-[13px] text-text-muted hover:bg-surface-3 hover:text-text"
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'F2') setEditing(true);
          }}
          title="Double-click to rename"
          data-testid="project-name"
        >
          {name}
        </button>
      )}
    </div>
  );
}
