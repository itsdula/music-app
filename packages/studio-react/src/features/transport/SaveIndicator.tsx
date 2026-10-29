import { useProjectState } from '../../session/context';

const LABELS = {
  idle: 'Not saved yet',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed — retrying',
  conflict: 'Saved elsewhere — reload to continue',
} as const;

export function SaveIndicator() {
  const status = useProjectState((s) => s.saveStatus);
  const tone =
    status === 'saved'
      ? 'bg-success'
      : status === 'error' || status === 'conflict'
        ? 'bg-record'
        : status === 'saving' || status === 'pending'
          ? 'bg-warning'
          : 'bg-text-faint';
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-text-muted" role="status" aria-live="polite" data-testid="save-status" data-status={status}>
      <span className={`size-1.5 rounded-full ${tone}`} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
