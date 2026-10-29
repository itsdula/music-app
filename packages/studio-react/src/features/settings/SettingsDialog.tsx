import { Dialog, DialogContent, IconButton, NumberField, Switch } from '@studio/ui';
import { Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useEngineState, useSession } from '../../session/context';

const LATENCY_KEY = 'studio.recording.latencyMs';

/** Audio/recording preferences. Values persist in host settings. */
export function SettingsDialog() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const capabilities = useEngineState((s) => s.capabilities);
  const manualMs = useEngineState((s) => s.recordLatencyMs);
  const estimateMs = ((capabilities?.baseLatencySeconds ?? 0) + (capabilities?.outputLatencySeconds ?? 0)) * 1000;

  const setManual = (value: number | null) => {
    session.engineStore.setState({ recordLatencyMs: value });
    void session.platform.settingsRepository.set(LATENCY_KEY, value);
  };

  return (
    <>
      <IconButton label="Settings" icon={<Settings2 />} variant="ghost" onClick={() => setOpen(true)} data-testid="open-settings" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Settings" description="Audio and recording preferences for this browser.">
          <div className="flex flex-col gap-4 text-[12px]">
            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">Audio</h3>
              <dl className="grid grid-cols-[180px_1fr] gap-y-1 text-text-muted">
                <dt>Engine</dt>
                <dd className="text-text">{capabilities?.backend ?? '—'}</dd>
                <dt>Sample rate</dt>
                <dd className="text-text">{capabilities ? `${capabilities.sampleRate} Hz` : '—'}</dd>
                <dt>Reported latency</dt>
                <dd className="text-text">
                  {capabilities?.baseLatencySeconds != null ? `${(capabilities.baseLatencySeconds * 1000).toFixed(1)} ms processing` : 'processing: not reported'}
                  {' · '}
                  {capabilities?.outputLatencySeconds != null ? `${(capabilities.outputLatencySeconds * 1000).toFixed(1)} ms output` : 'output: not reported'}
                </dd>
              </dl>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">Recording latency compensation</h3>
              <p className="text-text-faint">
                Browsers add input and output delay that varies by device. Recorded takes are shifted earlier by this amount so they line up with what you heard. Automatic uses the latency
                the browser reports ({estimateMs.toFixed(1)} ms here), which usually misses the input side; calibrate manually if takes sound late.
              </p>
              <label className="flex items-center justify-between gap-3">
                <span>Set manually</span>
                <Switch label="Set recording latency manually" checked={manualMs !== null} onCheckedChange={(on) => setManual(on ? Math.round(estimateMs) : null)} />
              </label>
              {manualMs !== null && (
                <label className="flex items-center justify-between gap-3">
                  <span>Compensation</span>
                  <NumberField
                    label="Recording latency compensation (ms)"
                    value={manualMs}
                    min={0}
                    max={500}
                    step={1}
                    format={(v) => `${Math.round(v)}`}
                    suffix={<span className="text-[10px] text-text-faint">ms</span>}
                    onChange={(v) => setManual(Math.round(v))}
                    className="w-24"
                  />
                </label>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
