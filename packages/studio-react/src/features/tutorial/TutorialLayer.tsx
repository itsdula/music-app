/**
 * Tutorial overlay: a spotlight around the step's target, a step card (title, body, progress,
 * Back/Next/Skip), the "tutorial complete" card and the first-run offer. Rendered inside the
 * Studio root, positioned relative to it, and non-blocking: everything except the cards lets
 * pointer events through so the user can operate the highlighted control.
 */
import { Button } from '@studio/ui';
import { GraduationCap, Hourglass, PartyPopper, SearchX } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  currentStep,
  FIRST_RUN_TUTORIAL_ID,
  type ActiveTutorial,
  type TutorialController,
} from './controller';
import {
  matchesTarget,
  placeCard,
  resolveTarget,
  TUTORIAL_LAYER_ATTR,
  type Box,
  type CardPosition,
} from './target';
import { useTutorialController, useTutorialState } from './use-tutorial';

/** How long to wait for a step's target before falling back to a centered card. */
export const TARGET_TIMEOUT_MS = 1500;
const SPOT_PADDING = 6;
const layerProps = { [TUTORIAL_LAYER_ATTR]: '' };

export function TutorialLayer() {
  const controller = useTutorialController();
  const active = useTutorialState((s) => s.active);
  const finished = useTutorialState((s) => s.finished);
  const offer = useTutorialState((s) => s.offer);
  return (
    <>
      {offer === 'show' && !active && <TutorialOffer controller={controller} />}
      {active && (
        <TutorialOverlay key={active.tutorial.id} controller={controller} active={active} />
      )}
      {!active && finished && (
        <TutorialFinished title={finished.title} onClose={() => controller.dismissFinished()} />
      )}
    </>
  );
}

function studioRoot(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>('[data-testid="studio-root"]') ?? el.parentElement ?? el;
}

type Schedule = (fn: () => void) => () => void;
const schedule: Schedule = (fn) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, 50);
  return () => clearTimeout(id);
};

interface Layout {
  readonly spot: Box | null;
  readonly card: CardPosition;
  readonly missing: boolean;
  /** The target is inside a modal dialog: lift the card and ring above it. */
  readonly raised: boolean;
}

function TutorialOverlay({
  controller,
  active,
}: {
  controller: TutorialController;
  active: ActiveTutorial;
}) {
  const step = currentStep(active)!;
  const { tutorial, stepIndex, stepKey } = active;
  const layerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const restoreRef = useRef<Element | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const titleId = useId();
  const bodyId = useId();

  // Follow the target every frame: it may mount late, move, resize, scroll or disappear.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const root = studioRoot(layer);
    const startedAt = Date.now();
    let element: HTMLElement | null = null;
    let frame = 0;
    let scrolled = false;
    let last = '';
    let cancel: () => void = () => undefined;
    const tick = () => {
      const rootBox = root.getBoundingClientRect();
      if (step.target && (!element || !element.isConnected || frame % 10 === 0))
        element = resolveTarget(root, step.target);
      frame += 1;
      let spot: Box | null = null;
      if (element) {
        const r = element.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          if (!scrolled) {
            scrolled = true;
            const outside =
              r.top < rootBox.top ||
              r.bottom > rootBox.bottom ||
              r.left < rootBox.left ||
              r.right > rootBox.right;
            if (outside) element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
          const left = Math.max(0, r.left - rootBox.left - SPOT_PADDING);
          const top = Math.max(0, r.top - rootBox.top - SPOT_PADDING);
          spot = {
            left,
            top,
            width: Math.min(rootBox.width - left, r.width + SPOT_PADDING * 2),
            height: Math.min(rootBox.height - top, r.height + SPOT_PADDING * 2),
          };
        }
      }
      const card = cardRef.current;
      const size = card
        ? { width: card.offsetWidth || 320, height: card.offsetHeight || 160 }
        : { width: 320, height: 160 };
      const next: Layout = {
        spot,
        card: placeCard(spot, size, rootBox, step.placement),
        missing: Boolean(step.target) && !spot && Date.now() - startedAt >= TARGET_TIMEOUT_MS,
        raised: Boolean(spot && element?.closest('[role="dialog"]')),
      };
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setLayout(next);
      }
      cancel = schedule(tick);
    };
    cancel = schedule(tick);
    return () => cancel();
  }, [step]);

  // Clicks on the target complete "click" steps.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const root = studioRoot(layer);
    const onClick = (event: MouseEvent) => {
      const el = event.target;
      if (!(el instanceof Element)) return;
      controller.reportClick((target) => matchesTarget(root, target, el));
    };
    root.addEventListener('click', onClick, true);
    return () => root.removeEventListener('click', onClick, true);
  }, [controller]);

  // Focus: take it when nothing has it (start, or the focused control vanished); never steal
  // it from a control the user is operating. Restore it when the tour ends.
  useEffect(() => {
    const doc = layerRef.current?.ownerDocument;
    restoreRef.current = doc?.activeElement ?? null;
    return () => {
      const previous = restoreRef.current;
      const now = previous?.ownerDocument.activeElement;
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (!now || now === previous.ownerDocument.body)
      )
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const focused = title.ownerDocument.activeElement;
    if (!focused || focused === title.ownerDocument.body) title.focus({ preventScroll: true });
  }, [stepKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      controller.skip();
    }
  };

  const total = tutorial.steps.length;
  const manual = step.advance.type === 'next';
  const last = stepIndex === total - 1;
  const waitingForTarget = Boolean(step.target) && !layout?.spot && !layout?.missing;
  const hidden = !layout || waitingForTarget;
  const spot = layout?.spot ?? null;
  const z = layout?.raised ? 'z-[60]' : 'z-[45]';
  const motion =
    'motion-safe:transition-[left,top,width,height] motion-safe:duration-200 motion-safe:ease-out';

  return (
    <div
      ref={layerRef}
      {...layerProps}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="tutorial-layer"
    >
      {spot ? (
        <div
          aria-hidden
          className={`absolute z-40 rounded-md ${motion}`}
          style={{ ...spot, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
        />
      ) : (
        !hidden && <div aria-hidden className="absolute inset-0 z-40 bg-black/30" />
      )}
      {spot && (
        <div
          aria-hidden
          className={`absolute ${z} rounded-md ring-2 ring-accent ring-offset-0 ${motion}`}
          style={spot}
          data-testid="tutorial-spotlight"
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`absolute ${z} flex w-80 max-w-[calc(100%-16px)] flex-col gap-2 rounded-lg border border-accent/40 bg-surface-2 p-3 text-text shadow-2xl shadow-black/60 outline-none ${motion} ${hidden ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'}`}
        style={{ left: layout?.card.left ?? 0, top: layout?.card.top ?? 0 }}
        data-testid="tutorial-card"
        data-tutorial-id={tutorial.id}
        data-step-id={step.id}
        data-step-index={stepIndex}
        data-target-missing={layout?.missing ? 'true' : undefined}
      >
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <GraduationCap className="size-3.5 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{tutorial.title}</span>
          <span className="tabular-nums" data-testid="tutorial-progress">
            {stepIndex + 1} of {total}
          </span>
        </div>
        <div className="flex gap-0.5" aria-hidden>
          {tutorial.steps.map((s, i) => (
            <span
              key={s.id}
              className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-accent' : 'bg-surface-3'}`}
            />
          ))}
        </div>
        <h2
          ref={titleRef}
          id={titleId}
          tabIndex={-1}
          className="text-[14px] leading-5 font-semibold outline-none"
        >
          {step.title}
        </h2>
        <p id={bodyId} className="text-[12px] leading-[18px] whitespace-pre-line text-text">
          {step.body}
        </p>
        {layout?.missing ? (
          <p
            className="flex items-center gap-1.5 text-[11px] text-text-muted"
            data-testid="tutorial-target-missing"
          >
            <SearchX className="size-3.5 shrink-0" aria-hidden />
            This control isn’t on screen right now. Follow the instructions, or press Next.
          </p>
        ) : (
          !manual && (
            <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Hourglass className="size-3.5 shrink-0 text-accent" aria-hidden />
              Waiting for you to do this — or press Next to skip it.
            </p>
          )
        )}
        <div className="flex items-center gap-1.5 pt-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => controller.skip()}
            data-testid="tutorial-skip"
          >
            Skip tour
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="secondary"
            disabled={stepIndex === 0}
            onClick={() => controller.back()}
            data-testid="tutorial-back"
          >
            Back
          </Button>
          <Button
            size="sm"
            variant={manual ? 'primary' : 'secondary'}
            onClick={() => controller.next()}
            data-testid="tutorial-next"
          >
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {`${tutorial.title}, step ${stepIndex + 1} of ${total}: ${step.title}. ${step.body}`}
      </div>
    </div>
  );
}

function TutorialFinished({ title, onClose }: { title: string; onClose: () => void }) {
  const titleId = useId();
  return (
    <div {...layerProps} className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className="pointer-events-auto absolute bottom-6 left-1/2 z-[60] flex w-80 max-w-[calc(100%-16px)] -translate-x-1/2 flex-col gap-2 rounded-lg border border-accent/40 bg-surface-2 p-3 text-text shadow-2xl shadow-black/60"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        data-testid="tutorial-complete"
      >
        <h2 id={titleId} className="flex items-center gap-2 text-[14px] font-semibold">
          <PartyPopper className="size-4 text-accent" aria-hidden />
          Tutorial complete
        </h2>
        <p className="text-[12px] text-text" role="status">
          You finished “{title}”. Find more tours in the Tutorials menu, or ask the assistant to
          walk you through anything.
        </p>
        <div className="flex justify-end">
          <Button size="sm" variant="primary" onClick={onClose} data-testid="tutorial-done">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function TutorialOffer({ controller }: { controller: TutorialController }) {
  return (
    <section
      {...layerProps}
      aria-label="Studio tour"
      className="flex shrink-0 items-center gap-3 border-t border-line bg-surface-2 px-3 py-1.5 text-[12px]"
      data-testid="tutorial-offer"
    >
      <GraduationCap className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="flex-1">
        New to Studio? Take the 2-minute tour: make a loop, add an effect and export it.
      </span>
      <Button
        size="sm"
        variant="primary"
        onClick={() => controller.start(FIRST_RUN_TUTORIAL_ID)}
        data-testid="tutorial-offer-start"
      >
        Start the tour
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => controller.declineOffer()}
        data-testid="tutorial-offer-dismiss"
      >
        Not now
      </Button>
    </section>
  );
}
