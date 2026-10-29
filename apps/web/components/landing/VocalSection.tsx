import { Check, Info } from 'lucide-react';
import { PitchEditorIllustration } from './illustrations';
import { Container, SectionHeader } from './primitives';

const POINTS = [
  'Detects the notes in a monophonic vocal and draws them on a pitch grid.',
  'Suggests the key and scale, with ranked alternatives if the first guess is wrong.',
  'Move a note to fix its pitch, or apply gentle automatic correction with a strength control.',
  'A/B compare the corrected take against the original at any time.',
  'Non-destructive: the original recording is never modified.',
];

export function VocalSection() {
  return (
    <section
      id="vocal-editor"
      aria-labelledby="vocal-title"
      className="scroll-mt-16 border-t border-line/60 py-20 sm:py-28"
    >
      <Container className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="order-2 lg:order-1">
          <PitchEditorIllustration className="h-auto w-full" />
        </div>
        <div className="order-1 lg:order-2">
          <SectionHeader id="vocal-title" eyebrow="Vocals" title="Vocal pitch editor">
            <p>
              Tidy up a sung take without leaving the browser. Studio analyses the recording and
              shows every note it hears, so you can fix the ones that drift.
            </p>
          </SectionHeader>
          <ul className="mt-8 space-y-3">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-3 text-[15px] leading-relaxed text-text">
                <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 flex gap-3 rounded-xl border border-line bg-surface-1 p-4 text-sm leading-relaxed text-text-muted">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              Designed for solo vocals, one voice at a time. Large pitch moves can sound processed.
            </span>
          </p>
        </div>
      </Container>
    </section>
  );
}
