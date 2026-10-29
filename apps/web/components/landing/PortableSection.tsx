import { FileJson, Globe, Lock, Puzzle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Container, SectionHeader } from './primitives';

const ITEMS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Globe />,
    title: 'Runs in the browser',
    body: 'Open a tab and start working. There is nothing to download or install.',
  },
  {
    icon: <Puzzle />,
    title: 'One component, many hosts',
    body: 'The whole workstation is a single component. The same code runs on this site and in other hosts, such as a standalone app.',
  },
  {
    icon: <Lock />,
    title: 'Your work stays on your device',
    body: 'Projects and recordings are stored locally. Core features need no account, server or network connection.',
  },
  {
    icon: <FileJson />,
    title: 'Open project format',
    body: 'Projects use a versioned, documented format. Bundles package a project with its audio so you can take it anywhere.',
  },
];

export function PortableSection() {
  return (
    <section
      id="portable"
      aria-labelledby="portable-title"
      className="scroll-mt-16 border-t border-line/60 bg-surface-1/40 py-20 sm:py-28"
    >
      <Container>
        <SectionHeader id="portable-title" eyebrow="Architecture" title="Built to be portable">
          <p>
            Studio is local-first by design. You own your files, and the app is not tied to a single
            website.
          </p>
        </SectionHeader>
        <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item) => (
            <li key={item.title} className="bg-surface-1 p-6">
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent-strong [&_svg]:size-[18px]"
              >
                {item.icon}
              </span>
              <h3 className="mt-5 font-semibold text-text">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
