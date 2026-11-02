import type { ProjectId } from '@studio/domain';
import type { ProjectSummary } from '@studio/project-storage';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@studio/ui';
import {
  ArrowRight,
  AudioWaveform,
  FilePlus2,
  FolderOpen,
  Music2,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLE_PROJECTS } from '../../generated/samples';
import { useSession } from '../../session/context';
import { importProjectFile, openSampleProject } from '../projects-page/actions';
import { GENRE_LABELS } from '../projects-page/samples';

type StartTab = 'new' | 'recent' | 'samples';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const rowClass =
  'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none disabled:opacity-60';

// `cn` does not merge classes, so overrides of TabsTrigger's underline style use `!`.
const tabClass =
  'mb-0! h-9 w-full justify-start gap-2.5 rounded-md border-b-0! px-2.5 text-[13px] data-[state=active]:bg-surface-3 data-[state=active]:text-text max-sm:w-auto max-sm:shrink-0 [&_svg]:size-4!';

/**
 * Shown over the workspace while no project is open (on every load, and after "Close project").
 * It cannot be dismissed: the user picks an empty project, one of their saved projects, or a copy
 * of a sample song.
 */
export function StartDialog() {
  const session = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null);
  const [tab, setTab] = useState<StartTab | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState<string>('all');
  const contentRef = useRef<HTMLDivElement>(null);

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
  // Until the user picks a tab: their projects if they have any, otherwise "New".
  const activeTab: StartTab = tab ?? (projects && projects.length > 0 ? 'recent' : 'new');

  return (
    <Dialog open>
      <DialogContent
        ref={contentRef}
        title="No project open"
        aria-describedby={undefined}
        hideTitle
        showClose={false}
        data-testid="start-screen"
        widthClassName="w-[min(52rem,calc(100vw-2rem))]"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        className="h-[min(34rem,calc(100vh-2rem))] gap-0! overflow-hidden p-0!"
        // Focus the dialog itself rather than ringing the first tab; Tab moves into it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => setTab(value as StartTab)}
          orientation="vertical"
          className="h-full min-h-0 flex-row max-sm:flex-col"
        >
          <aside className="flex w-52 shrink-0 flex-col gap-4 border-r border-line bg-surface-0/60 p-3 max-sm:w-auto max-sm:gap-3 max-sm:border-r-0 max-sm:border-b">
            <div className="flex items-center gap-2.5 px-1 pt-1">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent/60 text-white shadow-lg shadow-accent/20">
                <AudioWaveform className="size-5" aria-hidden />
              </span>
              <div className="min-w-0" aria-hidden>
                <p className="text-[15px] leading-tight font-semibold">Nawa</p>
                <p className="text-[11px] text-text-muted">No project open</p>
              </div>
            </div>
            <TabsList className="h-auto! flex-col items-stretch gap-0.5 border-b-0! max-sm:flex-row max-sm:overflow-x-auto">
              <TabsTrigger value="new" className={tabClass} data-testid="start-tab-new">
                <FilePlus2 aria-hidden />
                New project
              </TabsTrigger>
              <TabsTrigger value="recent" className={tabClass} data-testid="start-tab-recent">
                <FolderOpen aria-hidden />
                <span className="flex-1 text-left">Your projects</span>
                {projects && projects.length > 0 && (
                  <span className="text-[11px] text-text-faint tabular-nums">
                    {projects.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="samples" className={tabClass} data-testid="start-tab-samples">
                <Sparkles aria-hidden />
                <span className="flex-1 text-left">Samples</span>
                <span className="text-[11px] text-text-faint tabular-nums">
                  {SAMPLE_PROJECTS.length}
                </span>
              </TabsTrigger>
            </TabsList>
            <div className="mt-auto flex flex-col gap-2 max-sm:hidden">
              {busy && <Spinner size="sm" label="Opening project" />}
              <Button
                variant="ghost"
                icon={<Upload />}
                className="justify-start"
                data-testid="start-import"
                disabled={busy !== null}
                onClick={() => void run('import', () => importProjectFile(session))}
              >
                Import .studio file
              </Button>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {error && (
              <p
                role="alert"
                className="m-4 mb-0 rounded-md border border-record/40 bg-record/10 px-3 py-2 text-[12px]"
              >
                {error}
              </p>
            )}

            <TabsContent value="new" className="flex flex-col p-6 outline-none">
              <h2 className="text-[17px] font-semibold">Start something new</h2>
              <p className="mt-1 text-[12px] text-text-muted">
                Projects are saved on this device as you work. Nothing is uploaded.
              </p>
              <button
                type="button"
                className="group mt-6 flex items-center gap-4 rounded-xl border border-line bg-surface-2 p-4 text-left transition-colors hover:border-accent/60 hover:bg-surface-3 focus-visible:border-accent focus-visible:outline-none disabled:opacity-60"
                data-testid="start-new"
                disabled={busy !== null}
                onClick={() => void run('new', () => session.projects.newProject('empty'))}
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <FilePlus2 className="size-6" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">Empty project</span>
                  <span className="block text-[12px] text-text-muted">
                    One Keys track, ready for your first idea.
                  </span>
                </span>
                <ArrowRight
                  className="size-4 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none"
                  aria-hidden
                />
              </button>
              <button
                type="button"
                className="group mt-3 flex items-center gap-4 rounded-xl border border-dashed border-line p-4 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none"
                onClick={() => setTab('samples')}
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-muted group-hover:text-accent">
                  <Sparkles className="size-6" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">Or start from a sample</span>
                  <span className="block text-[12px] text-text-muted">
                    {SAMPLE_PROJECTS.length} finished songs across {genres.length} genres to take
                    apart.
                  </span>
                </span>
                <ArrowRight
                  className="size-4 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none"
                  aria-hidden
                />
              </button>
            </TabsContent>

            <TabsContent value="recent" className="flex min-h-0 flex-col outline-none">
              <div className="px-6 pt-6 pb-3">
                <h2 className="text-[17px] font-semibold">Your projects</h2>
                <p className="mt-1 text-[12px] text-text-muted">
                  Pick up where you left off. The newest is at the top.
                </p>
              </div>
              {projects === null ? (
                <p className="px-6 text-[12px] text-text-muted">Loading…</p>
              ) : projects.length === 0 ? (
                <div
                  className="mx-6 mb-6 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line p-6 text-center"
                  data-testid="start-recent-empty"
                >
                  <FolderOpen className="size-8 text-text-faint" aria-hidden />
                  <p className="text-[13px] font-medium">No saved projects yet</p>
                  <p className="max-w-64 text-[12px] text-text-muted">
                    Projects you create or open are saved here automatically.
                  </p>
                  <Button variant="primary" size="sm" onClick={() => setTab('new')}>
                    Create a project
                  </Button>
                </div>
              ) : (
                <ul
                  className="min-h-0 flex-1 list-none overflow-y-auto px-3 pb-3"
                  aria-label="Your projects"
                  data-testid="start-recent-list"
                >
                  {projects.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={rowClass}
                        data-testid="start-recent"
                        data-project-id={p.id}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`open:${p.id}`, () => session.projects.open(p.id as ProjectId))
                        }
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                          <Music2 className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{p.name}</span>
                          <span className="block text-[11px] text-text-faint">
                            {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'} · edited{' '}
                            {formatDate(p.updatedAt)}
                          </span>
                        </span>
                        {p.id === lastOpenedId && <Badge tone="accent">Last opened</Badge>}
                        {busy === `open:${p.id}` ? (
                          <Spinner size="sm" label="Opening" />
                        ) : (
                          <ArrowRight
                            className="size-4 text-text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                            aria-hidden
                          />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="samples" className="flex min-h-0 flex-col outline-none">
              <div className="flex flex-col gap-3 px-6 pt-6 pb-3">
                <div>
                  <h2 className="text-[17px] font-semibold">Start from a sample</h2>
                  <p className="mt-1 text-[12px] text-text-muted">
                    Opens a copy of a finished song. The original stays as it is.
                  </p>
                </div>
                <div
                  className="flex flex-wrap gap-1"
                  role="group"
                  aria-label="Filter samples by genre"
                >
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
              <ul
                className="grid min-h-0 flex-1 list-none auto-rows-min grid-cols-1 gap-1 overflow-y-auto px-3 pb-3 sm:grid-cols-2"
                aria-label="Sample songs"
                data-testid="start-samples-list"
              >
                {samples.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={rowClass}
                      data-testid="start-sample"
                      data-sample-id={s.id}
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`sample:${s.id}`, () => openSampleProject(session, s))
                      }
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
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
