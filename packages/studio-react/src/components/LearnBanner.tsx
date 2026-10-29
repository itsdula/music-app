import { Button } from '@studio/ui';
import { useStore } from 'zustand';
import { useProjectState, useSession, useUiState } from '../session/context';
import { describeSource, describeTarget } from '../features/midi-controller/mapping-helpers';

/** MIDI Learn status: listening → captured (confirm scope) → idle. */
export function LearnBanner() {
  const session = useSession();
  const learn = useStore(session.midi.store, (s) => s.learn);
  const project = useProjectState((s) => s.project);
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  if (learn.phase === 'idle') return null;
  const target = describeTarget(project, learn.target, selectedTrackId);
  return (
    <div role="status" aria-live="assertive" className="flex items-center gap-3 border-b border-accent/40 bg-accent/15 px-3 py-1.5 text-[12px]" data-testid="learn-banner">
      <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden />
      {learn.phase === 'listening' ? (
        <span className="flex-1">
          MIDI Learn: move a knob, press a pad or key on your controller to map it to <strong>{target}</strong>.
        </span>
      ) : (
        <span className="flex-1">
          Captured <strong>{describeSource(learn.mapping.source)}</strong> → <strong>{target}</strong>.
        </span>
      )}
      {learn.phase === 'captured' && (
        <>
          <Button size="sm" variant="primary" onClick={() => void session.midi.confirmLearn('project')} data-testid="learn-confirm-project">
            Map in this project
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void session.midi.confirmLearn('global')}>
            Map for all projects
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={() => session.midi.cancelLearn()}>
        Cancel
      </Button>
    </div>
  );
}
