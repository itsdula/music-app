import type { ProjectId } from '@studio/domain';
import type { ProjectSummary } from '@studio/project-storage';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  IconButton,
  Spinner,
} from '@studio/ui';
import {
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Music2,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SAMPLE_PROJECTS } from '../../generated/samples';
import { useProjectState, useSession } from '../../session/context';
import { navigate } from '../../state/ui-store';
import { importProjectFile, openSampleProject } from './actions';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { GENRE_LABELS, type SampleProject } from './samples';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The project library: every saved project with open, rename, configure, duplicate, export
 * and delete, plus the built-in sample songs grouped by genre.
 */
export function ProjectsPage() {
  const session = useSession();
  const currentId = useProjectState((s) => s.project.id);
  const currentName = useProjectState((s) => s.project.name);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ProjectId | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectSummary | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [genre, setGenre] = useState<string>('all');

  const refresh = useCallback(async () => {
    await session.projects.flush().catch(() => undefined);
    setProjects(await session.projects.list());
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    void session.projects
      .flush()
      .catch(() => undefined)
      .then(() => session.projects.list())
      .then((list) => {
        if (!cancelled) setProjects(list);
      });
    return () => {
      cancelled = true;
    };
  }, [session, currentName]);

  const run = async (label: string, action: () => Promise<unknown>, thenOpenStudio = false) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      if (thenOpenStudio) session.uiStore.setState((s) => navigate(s, 'arrange'));
      else await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const openSample = (sample: SampleProject) =>
    run(`sample:${sample.id}`, () => openSampleProject(session, sample), true);

  const importFile = () => run('import', () => importProjectFile(session), true);

  const samples = useMemo(
    () => (genre === 'all' ? SAMPLE_PROJECTS : SAMPLE_PROJECTS.filter((s) => s.genre === genre)),
    [genre],
  );
  const genres = useMemo(() => [...new Set(SAMPLE_PROJECTS.map((s) => s.genre))], []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-0" data-testid="projects-page">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-6">
        <header className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-[18px] font-semibold">Projects</h1>
            <p className="text-[12px] text-text-muted">
              Stored in this browser. Open one to continue, or start from a sample.
            </p>
          </div>
          <Button
            variant="primary"
            icon={<FilePlus2 />}
            data-testid="projects-new"
            onClick={() => void run('new', () => session.projects.newProject('empty'), true)}
          >
            New project
          </Button>
          <Button
            variant="secondary"
            icon={<Sparkles />}
            onClick={() => void run('demo', () => session.projects.newProject('demo'), true)}
          >
            New demo
          </Button>
          <Button variant="secondary" icon={<Upload />} onClick={() => void importFile()}>
            Import .studio
          </Button>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-[12px]"
          >
            {error}
          </p>
        )}

        <section aria-labelledby="projects-mine">
          <div className="mb-2 flex items-center gap-2">
            <h2 id="projects-mine" className="text-[13px] font-semibold">
              Your projects
            </h2>
            {busy && <Spinner size="sm" label="Working" />}
          </div>
          {projects === null ? (
            <p className="text-[12px] text-text-muted">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="text-[12px] text-text-muted">No saved projects yet.</p>
          ) : (
            <ul
              className="divide-y divide-line/60 rounded-lg border border-line bg-surface-1"
              data-testid="projects-list"
            >
              {projects.map((p) => {
                const isCurrent = p.id === currentId;
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2"
                    data-testid="project-row"
                    data-project-id={p.id}
                  >
                    <Music2 className="size-4 shrink-0 text-accent" aria-hidden />
                    <div className="min-w-0 flex-1">
                      {renaming === p.id ? (
                        <input
                          className="h-7 w-full max-w-80 rounded-md border border-accent bg-surface-0 px-2 text-[13px] outline-none"
                          defaultValue={p.name}
                          aria-label="Project name"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          onBlur={(e) => {
                            const name = e.currentTarget.value.trim();
                            setRenaming(null);
                            if (!name || name === p.name) return;
                            void run('rename', async () => {
                              if (isCurrent) session.projects.rename(name);
                              else await session.projects.renameStored(p.id, name);
                            });
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="truncate text-left text-[13px] font-medium hover:underline"
                          onClick={() =>
                            isCurrent
                              ? session.uiStore.setState((s) => navigate(s, 'arrange'))
                              : void run('open', () => session.projects.open(p.id), true)
                          }
                        >
                          {p.name}
                        </button>
                      )}
                      <p className="text-[11px] text-text-faint">
                        {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'} · edited{' '}
                        {formatDate(p.updatedAt)}
                      </p>
                    </div>
                    {isCurrent && <Badge tone="accent">Open</Badge>}
                    <IconButton
                      label={isCurrent ? 'Back to this project' : `Open ${p.name}`}
                      icon={<FolderOpen />}
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        isCurrent
                          ? session.uiStore.setState((s) => navigate(s, 'arrange'))
                          : void run('open', () => session.projects.open(p.id), true)
                      }
                    />
                    {isCurrent && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid="project-settings"
                        onClick={() => setSettingsOpen(true)}
                      >
                        Settings
                      </Button>
                    )}
                    <IconButton
                      label={`Rename ${p.name}`}
                      icon={<Pencil />}
                      size="sm"
                      variant="ghost"
                      onClick={() => setRenaming(p.id)}
                    />
                    <IconButton
                      label={`Duplicate ${p.name}`}
                      icon={<Copy />}
                      size="sm"
                      variant="ghost"
                      data-testid="project-duplicate"
                      onClick={() => void run('duplicate', () => session.projects.duplicate(p.id))}
                    />
                    <IconButton
                      label={`Export ${p.name}`}
                      icon={<Download />}
                      size="sm"
                      variant="ghost"
                      disabled={!isCurrent}
                      onClick={() => void run('export', () => session.projects.exportBundle())}
                    />
                    <IconButton
                      label={
                        isCurrent
                          ? 'Open another project before deleting this one'
                          : `Delete ${p.name}`
                      }
                      icon={<Trash2 />}
                      size="sm"
                      variant="ghost"
                      disabled={isCurrent}
                      data-testid="project-delete"
                      onClick={() => setConfirmDelete(p)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="projects-samples">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id="projects-samples" className="flex-1 text-[13px] font-semibold">
              Sample projects
            </h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter samples by genre">
              {['all', ...genres].map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant={genre === g ? 'primary' : 'ghost'}
                  aria-pressed={genre === g}
                  onClick={() => setGenre(g)}
                >
                  {g === 'all' ? 'All' : (GENRE_LABELS[g] ?? g)}
                </Button>
              ))}
            </div>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="samples-list">
            {samples.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 rounded-lg border border-line bg-surface-1 p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-[13px] font-medium">{s.title}</span>
                  <Badge tone="neutral">{GENRE_LABELS[s.genre] ?? s.genre}</Badge>
                </div>
                <p className="line-clamp-2 text-[11px] text-text-muted">{s.description}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-text-faint">
                  <span className="flex-1">
                    {s.bpm} BPM · {s.bars} bars · {s.tracks} tracks
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="sample-open"
                    disabled={busy !== null}
                    onClick={() => void openSample(s)}
                  >
                    {busy === `sample:${s.id}` ? 'Opening…' : 'Open copy'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent
          title="Delete project?"
          description="This removes it from this browser and cannot be undone. Export it first if you want a copy."
        >
          <p className="text-[13px]">
            <strong>{confirmDelete?.name}</strong>
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              data-testid="project-delete-confirm"
              onClick={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (target) void run('delete', () => session.projects.deleteProject(target.id));
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProjectSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
