import { Button, ToggleButton } from '@studio/ui';
import { Pause } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSession } from '../../session/context';
import type { MidiDiagnosticEntry } from '../../session/midi-controller';

/** Sanitized log of recent MIDI input (descriptions only; SysEx truncated by midi-core). */
export function DiagnosticsLog() {
  const session = useSession();
  const [entries, setEntries] = useState<readonly MidiDiagnosticEntry[]>(() => [
    ...session.midi.recentEvents(),
  ]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    let frame: number | null = null;
    const unsubscribe = session.midi.subscribeDiagnostics(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setEntries([...session.midi.recentEvents()]);
      });
    });
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [session, paused]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="midi-diagnostics">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px]">
        <span className="text-text-muted">Last {entries.length} MIDI messages</span>
        <div className="flex-1" />
        <ToggleButton
          size="sm"
          label="Pause log"
          tone="warning"
          pressed={paused}
          icon={<Pause />}
          onPressedChange={setPaused}
        />
        <Button size="sm" variant="ghost" onClick={() => session.midi.panic()}>
          Panic (all notes off)
        </Button>
      </div>
      <ol className="min-h-0 flex-1 overflow-auto font-mono text-[11px]" aria-live="off">
        {[...entries].reverse().map((e) => (
          <li
            key={e.seq}
            className="grid grid-cols-[72px_120px_1fr_120px_80px] gap-2 border-b border-line/40 px-3 py-0.5"
          >
            <span className="text-text-faint tabular-nums">{(e.timeMs / 1000).toFixed(3)}</span>
            <span className="truncate text-text-muted">{e.portName}</span>
            <span className="truncate text-text">{e.text}</span>
            <span className="truncate text-text-faint">{e.bytes}</span>
            <span className={e.routed === 'ignored' ? 'text-text-faint' : 'text-accent'}>
              {e.routed}
            </span>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="px-3 py-3 font-sans text-text-faint">
            No MIDI received yet. Play a key or move a knob.
          </li>
        )}
      </ol>
    </div>
  );
}
