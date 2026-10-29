import {
  Activity,
  Gauge,
  Info,
  Keyboard,
  MousePointerClick,
  MonitorSmartphone,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ControllerIllustration } from './illustrations';
import { Container, Pill, SectionHeader } from './primitives';

function Capability({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent-strong [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <div>
        <h3 className="font-semibold text-text">{title}</h3>
        <p className="mt-1 text-[15px] leading-relaxed text-text-muted">{children}</p>
      </div>
    </li>
  );
}

export function ControllerSection() {
  return (
    <section
      id="controller"
      aria-labelledby="controller-title"
      className="scroll-mt-16 border-t border-line/60 bg-surface-1/40 py-20 sm:py-28"
    >
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <SectionHeader
              id="controller-title"
              eyebrow="MIDI controller"
              title="AKAI Professional MPK Mini MK3 integration"
            >
              <p>
                Connect the controller over USB and play. Studio recognises it, maps its keys, pads
                and knobs to sensible defaults, and lets you change any of them.
              </p>
            </SectionHeader>
            <div className="mt-6 flex flex-wrap gap-2">
              <Pill tone="warning">Not yet verified on a physical unit</Pill>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface-0/60 p-4 sm:p-6">
            <ControllerIllustration className="h-auto w-full" />
          </div>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-16">
          <ul className="grid gap-8 sm:grid-cols-2">
            <Capability icon={<Keyboard />} title="Keys and pads play your tracks">
              The keys play notes on the selected instrument track, and the pads trigger notes too,
              so you can finger-drum a beat.
            </Capability>
            <Capability icon={<Gauge />} title="Knobs with soft takeover">
              The eight knobs are mapped to mixer and instrument controls. Soft takeover waits until
              a knob reaches the current value, so nothing jumps.
            </Capability>
            <Capability icon={<MousePointerClick />} title="MIDI Learn for anything">
              Put a Studio control into learn mode, then move a knob or press a pad to link them.
            </Capability>
            <Capability icon={<MonitorSmartphone />} title="On-screen controller view">
              A drawing of the controller lights up as you play, so you can see exactly what Studio
              receives.
            </Capability>
            <Capability icon={<Activity />} title="Diagnostics">
              Check the connection and watch incoming MIDI messages when something does not respond
              as expected.
            </Capability>
          </ul>

          <aside
            aria-labelledby="controller-notes-title"
            className="h-fit rounded-2xl border border-line bg-surface-1 p-6"
          >
            <div className="flex items-center gap-2 text-text">
              <Info aria-hidden="true" className="size-4 text-warning" />
              <h3 id="controller-notes-title" className="font-semibold">
                Good to know
              </h3>
            </div>
            <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-text-muted">
              <li>
                Studio maps the controller in software. It does not read or edit the
                controller&rsquo;s internal programs, because AKAI Professional publishes no
                protocol for that.
              </li>
              <li>
                Support is built from published documentation and community research and has not yet
                been verified on a physical unit.
              </li>
              <li>
                Controllers use Web MIDI, which needs Chrome or Edge. Firefox works after installing
                a site-permission add-on; Safari has no Web MIDI.
              </li>
            </ul>
          </aside>
        </div>
      </Container>
    </section>
  );
}
