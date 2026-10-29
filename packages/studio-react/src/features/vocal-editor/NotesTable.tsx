/**
 * Text alternative to the pitch canvas: every detected note as a table row. Rows are
 * selectable with click/Enter/Space (Shift toggles) and accept the same keyboard commands
 * as the canvas, so the editor is fully usable without a pointer or sight of the canvas.
 */
import { midiToNoteName, type VocalEditDoc, type VocalNoteId } from '@studio/domain';
import { useRef } from 'react';
import type { VocalActions } from './actions';
import { LOW_CONFIDENCE } from './geometry';
import { handleVocalKey } from './keys';
import {
  centsFromNearest,
  displayTargetMidi,
  formatCents,
  formatSeconds,
  hasManualTarget,
  noteEditOf,
  pitchLabel,
  sortedSegments,
} from './model';
import { useNativeKeyDown } from './use-vocal';

export function NotesTable({
  doc,
  selected,
  actions,
  splitTimes,
}: {
  doc: VocalEditDoc;
  selected: ReadonlySet<VocalNoteId>;
  actions: VocalActions;
  splitTimes: () => readonly (number | null)[];
}) {
  const rows = sortedSegments(doc.segments);
  const tableRef = useRef<HTMLTableElement>(null);
  useNativeKeyDown(tableRef, (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const row =
        e.target instanceof Element ? e.target.closest<HTMLElement>('tr[data-note-id]') : null;
      const id = row?.dataset.noteId as VocalNoteId | undefined;
      if (!id) return false;
      actions.select([id], e.shiftKey ? 'toggle' : 'replace');
      return true;
    }
    return handleVocalKey(e, actions, splitTimes);
  });
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="vocal-notes-table">
      <table
        ref={tableRef}
        className="vocal-notes-table w-full border-collapse text-[11px] tabular-nums"
        aria-label="Detected notes"
        aria-multiselectable="true"
        role="grid"
      >
        <thead className="sticky top-0 bg-surface-1 text-left text-text-muted">
          <tr>
            <th scope="col" className="px-2 py-1 font-medium">
              #
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Start
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Length
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Detected
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Cents
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Confidence
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Target
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((segment, index) => {
            const edit = noteEditOf(doc, segment.id);
            const isSelected = selected.has(segment.id);
            const target = edit.bypass
              ? 'Bypassed'
              : hasManualTarget(edit)
                ? `${pitchLabel(edit.targetMidi)} (manual)`
                : `${pitchLabel(displayTargetMidi(segment, doc))} (auto)`;
            return (
              <tr
                key={segment.id}
                tabIndex={0}
                aria-selected={isSelected}
                data-testid="vocal-note-row"
                className="cursor-default border-t border-line outline-none hover:bg-surface-2 focus-visible:bg-surface-3 aria-selected:bg-accent/15"
                onClick={(e) =>
                  actions.select(
                    [segment.id],
                    e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace',
                  )
                }
                data-note-id={segment.id}
              >
                <td className="px-2 py-1 text-text-faint">{index + 1}</td>
                <td className="px-2 py-1">{formatSeconds(segment.startSeconds)}</td>
                <td className="px-2 py-1">
                  {formatSeconds(segment.endSeconds - segment.startSeconds)}
                </td>
                <td className="px-2 py-1 font-medium">{midiToNoteName(segment.detectedMidi)}</td>
                <td className="px-2 py-1">{formatCents(centsFromNearest(segment.detectedMidi))}</td>
                <td
                  className={
                    segment.confidence < LOW_CONFIDENCE ? 'px-2 py-1 text-warning' : 'px-2 py-1'
                  }
                >
                  {Math.round(segment.confidence * 100)}%
                  {segment.confidence < LOW_CONFIDENCE ? ' (low)' : ''}
                </td>
                <td className="px-2 py-1">{target}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
