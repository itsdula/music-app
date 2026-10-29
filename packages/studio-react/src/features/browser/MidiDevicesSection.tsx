import { Badge, Button } from '@studio/ui';
import { Cable, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'zustand';
import { useSession } from '../../session/context';

const STATUS_TEXT = {
  unsupported: 'This browser has no Web MIDI support (use Chrome or Edge on desktop).',
  idle: 'MIDI is off.',
  requesting: 'Waiting for permission…',
  granted: 'MIDI connected.',
  denied: 'MIDI permission was denied. Allow MIDI for this site in the browser settings.',
  error: 'MIDI could not start.',
} as const;

export function MidiDevicesSection() {
  const session = useSession();
  const status = useStore(session.midi.store, (s) => s.status);
  const devices = useStore(session.midi.store, (s) => s.devices);
  const [open, setOpen] = useState(true);
  const inputs = devices.filter((d) => d.type === 'input');
  return (
    <section className="border-b border-line/60" data-testid="midi-devices">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold tracking-wide text-text-muted uppercase hover:text-text"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden />
        )}
        <Cable className="size-3.5" aria-hidden />
        MIDI Devices
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 text-[12px]">
          <p className="text-text-muted" role="status">
            {STATUS_TEXT[status]}
          </p>
          {(status === 'idle' || status === 'denied' || status === 'error') && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void session.midi.requestAccess()}
              data-testid="midi-connect"
            >
              Connect MIDI
            </Button>
          )}
          {status === 'granted' && inputs.length === 0 && (
            <p className="text-text-faint">No MIDI inputs found. Plug in a controller.</p>
          )}
          <ul className="space-y-1">
            {inputs.map((d) => (
              <li key={d.portId} className="flex items-center gap-2" data-testid="midi-device">
                <span
                  className={`size-1.5 rounded-full ${d.state === 'connected' ? 'bg-success' : 'bg-text-faint'}`}
                  aria-hidden
                />
                <span className="flex-1 truncate" title={d.name}>
                  {d.displayName}
                </span>
                {d.profileName && <Badge tone="accent">Profile</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
