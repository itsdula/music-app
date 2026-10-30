import { clampBpm, isValidTimeSignature, type TimeSignatureDenominator } from '@studio/domain';
import { Button, Dialog, DialogContent, DialogFooter, NumberField, Switch } from '@studio/ui';
import { useProjectState, useSession } from '../../session/context';

/**
 * Settings of the open project. Every change is a normal command, so it is undoable and
 * autosaved like any other edit.
 */
export function ProjectSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const session = useSession();
  const project = useProjectState((s) => s.project);
  const exec = session.history.execute.bind(session.history);

  const field = (label: string, control: React.ReactNode) => (
    <label className="flex items-center justify-between gap-4 text-[12px]">
      <span className="text-text-muted">{label}</span>
      {control}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Project settings"
        description="Changes apply immediately and can be undone."
        data-testid="project-settings-dialog"
      >
        <div className="flex flex-col gap-3">
          {field(
            'Name',
            <input
              key={project.id}
              className="h-7 w-56 rounded-md border border-line bg-surface-0 px-2 text-[13px] outline-none focus:border-accent"
              defaultValue={project.name}
              aria-label="Project name"
              onBlur={(e) => session.projects.rename(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />,
          )}
          {field(
            'Tempo',
            <NumberField
              label="Tempo (BPM)"
              value={project.bpm}
              min={20}
              max={300}
              step={1}
              fineStep={0.1}
              suffix="BPM"
              onChange={(bpm) =>
                exec(
                  { type: 'project.setTempo', bpm: clampBpm(bpm) },
                  { label: 'Set Tempo', coalesceKey: 'settings:tempo' },
                )
              }
            />,
          )}
          {field(
            'Time signature',
            <span className="flex items-center gap-1">
              <NumberField
                label="Beats per bar"
                value={project.meter.numerator}
                min={1}
                max={16}
                onChange={(numerator) => {
                  const meter = { ...project.meter, numerator };
                  if (isValidTimeSignature(meter))
                    exec({ type: 'project.setMeter', meter }, { label: 'Set Time Signature' });
                }}
              />
              <span className="text-text-faint">/</span>
              <NumberField
                label="Beat unit"
                value={project.meter.denominator}
                min={1}
                max={16}
                onChange={(denominator) => {
                  const meter = {
                    ...project.meter,
                    denominator: denominator as TimeSignatureDenominator,
                  };
                  if (isValidTimeSignature(meter))
                    exec({ type: 'project.setMeter', meter }, { label: 'Set Time Signature' });
                }}
              />
            </span>,
          )}
          {field(
            'Master volume',
            <NumberField
              label="Master volume (dB)"
              value={project.master.gainDb}
              min={-60}
              max={6}
              step={0.5}
              suffix="dB"
              onChange={(gainDb) =>
                exec(
                  { type: 'master.setGain', gainDb },
                  { label: 'Master Volume', coalesceKey: 'settings:master' },
                )
              }
            />,
          )}
          {field(
            'Metronome',
            <Switch
              aria-label="Metronome"
              checked={project.metronome.enabled}
              onCheckedChange={(enabled) =>
                exec(
                  { type: 'project.setMetronome', metronome: { enabled } },
                  { label: 'Metronome' },
                )
              }
            />,
          )}
          {field(
            'Loop playback',
            <Switch
              aria-label="Loop playback"
              checked={project.loop.enabled}
              onCheckedChange={(enabled) =>
                exec({ type: 'project.setLoop', loop: { enabled } }, { label: 'Loop' })
              }
            />,
          )}
        </div>
        <DialogFooter>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
