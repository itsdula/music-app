import { Button, Dialog, DialogContent, ProgressBar, SegmentedControl, Switch } from '@studio/ui';
import { useState } from 'react';
import { useProjectState, useSession } from '../../session/context';
import {
  exportRangeTicks,
  type ExportOptions,
  type ExportRange,
} from '../../session/export-controller';

export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const session = useSession();
  const project = useProjectState((s) => s.project);
  const [range, setRange] = useState<ExportRange>('arrangement');
  const [sampleRate, setSampleRate] = useState<'44100' | '48000'>('48000');
  const [bitDepth, setBitDepth] = useState<'16' | '24' | '32'>('16');
  const [includeTail, setIncludeTail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const available = exportRangeTicks(project, range) !== null;

  const run = async () => {
    setBusy(true);
    setResult(null);
    setProgress(0);
    const options: ExportOptions = {
      range,
      sampleRate: Number(sampleRate) as 44100 | 48000,
      bitDepth: Number(bitDepth) as 16 | 24 | 32,
      includeTail,
    };
    try {
      const out = await session.exporter.exportWav(project, options, {
        onProgress: (p) => setProgress(p.fraction),
      });
      const peakDb = out.peak > 0 ? 20 * Math.log10(out.peak) : -Infinity;
      setResult(
        `${out.saved ? 'Exported' : 'Rendered'} ${out.fileName} · ${out.durationSeconds.toFixed(2)} s · peak ${Number.isFinite(peakDb) ? peakDb.toFixed(1) : '-inf'} dBFS${out.peak >= 1 ? ' (clipping — lower the master level)' : ''}`,
      );
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Export audio"
        description="Offline WAV bounce through the same mix and effects you hear."
      >
        <div className="flex flex-col gap-3 text-[12px]" data-testid="export-dialog">
          <label className="flex items-center justify-between gap-3">
            <span className="text-text-muted">Range</span>
            <SegmentedControl
              label="Export range"
              value={range}
              onChange={setRange}
              options={[
                { value: 'arrangement', label: 'Arrangement' },
                { value: 'loop', label: 'Loop region' },
              ]}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-text-muted">Sample rate</span>
            <SegmentedControl
              label="Sample rate"
              value={sampleRate}
              onChange={setSampleRate}
              options={[
                { value: '44100', label: '44.1 kHz' },
                { value: '48000', label: '48 kHz' },
              ]}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-text-muted">Format</span>
            <SegmentedControl
              label="Bit depth"
              value={bitDepth}
              onChange={setBitDepth}
              options={[
                { value: '16', label: '16-bit' },
                { value: '24', label: '24-bit' },
                { value: '32', label: '32-bit float' },
              ]}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-text-muted">Include effect tails</span>
            <Switch
              label="Include effect tails"
              checked={includeTail}
              onCheckedChange={setIncludeTail}
            />
          </label>
          {busy && <ProgressBar label="Rendering" value={progress} />}
          {result && (
            <p
              className="rounded-md bg-surface-0 p-2 text-text-muted"
              role="status"
              data-testid="export-result"
            >
              {result}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              disabled={busy || !available}
              onClick={() => void run()}
              data-testid="export-start"
            >
              {busy ? 'Rendering…' : 'Export WAV'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
