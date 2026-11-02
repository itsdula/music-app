import type { ProjectId } from '@studio/domain';
import type { ProjectSummary } from '@studio/project-storage';
import { Badge, Button, Spinner } from '@studio/ui';
import { AudioWaveform, FilePlus2, FolderOpen, Music2, Sparkles, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SAMPLE_PROJECTS } from '../../generated/samples';
import { useSession } from '../../session/context';
import { importProjectFile, openSampleProject } from '../projects-page/actions';
import { GENRE_LABELS } from '../projects-page/samples';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function StartCard({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-h-0 flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent [&_svg]:size-4">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-[14px] font-semibold">
            {title}
          </h2>
          <p className="text-[12px] text-text-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Shown while no project is open (on every load, and after "Close project"): the user picks an
 * empty project, one of their saved projects, or a copy of a sample song.
 */
export function StartScreen() {
  const session = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([session.projects.list(), session.projects.lastOpenedId()]).then(
      ([list, last]) => {
        if (cancelled) return;
        setProjects(list);
        setLastOpenedId(last);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setProjects([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [session]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const genres = useMemo(() => [...new Set(SAMPLE_PROJECTS.map((s) => s.genre))], []);
  const samples = useMemo(
    () => (genre === 'all' ? SAMPLE_PROJECTS : SAMPLE_PROJECTS.filter((s) => s.genre === genre)),
    [genre],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-0"
      data-testid="start-screen"
    >
      <div className="mx-auto my-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <AudioWaveform className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <h1 className="text-[20px] font-semibold">No project open</h1>
            <p className="text-[12px] text-text-muted">
              Start a new project, continue one you saved, or open a copy of a sample song.
            </p>
          </div>
          {busy && <Spinner label="Opening project" />}
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-[12px]"
          >
            {error}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <StartCard
            id="start-new-title"
            icon={<FilePlus2 />}
            title="New project"
            description="An empty arrangement with one Keys track, ready for your first idea."
          >
            <div className="mt-auto">
              <Button
                variant="primary"
                icon={<FilePlus2 />}
                data-testid="start-new"
                disabled={busy !== null}
                onClick={() => void run('new', () => session.projects.newProject('empty'))}
              >
                Create empty project
              </Button>
            </div>
          </StartCard>

          <StartCard
            id="start-recent-title"
            icon={<FolderOpen />}
            title="Open a project"
            description="Projects are saved on this device as you work."
          >
            {projects === null ? (
              <p className="text-[12px] text-text-muted">Loading…</p>
            ) : projects.length === 0 ? (
              <p
                className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-text-muted"
                data-testid="start-recent-empty"
              >
                No saved projects yet. Projects you create or open appear here.
              </p>
            ) : (
              <ul
                className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line"
                aria-labelledby="start-recent-title"
                data-testid="start-recent-list"
              >
                {projects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-60"
                      data-testid="start-recent"
                      data-project-id={p.id}
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`open:${p.id}`, () => session.projects.open(p.id as ProjectId))
                      }
                    >
                      <Music2 className="size-4 shrink-0 text-accent" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{p.name}</span>
                        <span className="block text-[11px] text-text-faint">
                          {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'} · edited{' '}
                          {formatDate(p.updatedAt)}
                        </span>
                      </span>
                      {p.id === lastOpenedId && <Badge tone="accent">Last opened</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto">
              <Button
                variant="secondary"
                icon={<Upload />}
                data-testid="start-import"
                disabled={busy !== null}
                onClick={() => void run('import', () => importProjectFile(session))}
              >
                Import .studio file
              </Button>
            </div>
          </StartCard>

          <StartCard
            id="start-samples-title"
            icon={<Sparkles />}
            title="Start from a sample"
            description="Open a copy of a finished song and take it apart. The original stays as it is."
          >
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
            <ul
              className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line"
              aria-labelledby="start-samples-title"
              data-testid="start-samples-list"
            >
              {samples.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-60"
                    data-testid="start-sample"
                    data-sample-id={s.id}
                    disabled={busy !== null}
                    onClick={() => void run(`sample:${s.id}`, () => openSampleProject(session, s))}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{s.title}</span>
                      <span className="block text-[11px] text-text-faint">
                        {s.bpm} BPM · {s.bars} bars · {s.tracks} tracks
                      </span>
                    </span>
                    {busy === `sample:${s.id}` ? (
                      <Spinner size="sm" label="Opening" />
                    ) : (
                      <Badge tone="neutral">{GENRE_LABELS[s.genre] ?? s.genre}</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </StartCard>
        </div>
      </div>
    </div>
  );
}
