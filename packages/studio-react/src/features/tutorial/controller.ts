/**
 * Runs one tutorial at a time against a Studio session: step transitions (start, next, back,
 * skip, stop), `before` actions, advance rules (manual, click, tool call, state condition) and
 * progress persistence for built-in tours. Framework-free: React reads `store`, the overlay
 * reports clicks, and tools call the same methods. One controller per session (`forSession`).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StudioSession } from '../../session/studio-session';
import { navigate } from '../../state/ui-store';
import { BUILTIN_TUTORIALS } from './builtin';
import { evaluateCondition, measure, snapshotSession, type TutorialBaseline } from './conditions';
import type { Tutorial, TutorialStep } from './schema';

export const PROGRESS_KEY = 'studio.tutorials.progress';
export const OFFER_KEY = 'studio.tutorials.firstRunOffer';
/** The tour the first-run prompt offers. */
export const FIRST_RUN_TUTORIAL_ID = 'getting-started';

export interface TutorialProgress {
  readonly status: 'completed' | 'dismissed';
  readonly at: string;
}

export interface ActiveTutorial {
  readonly tutorial: Tutorial;
  readonly builtIn: boolean;
  readonly stepIndex: number;
  /** Increments on every step entry (also when re-entering the same index). */
  readonly stepKey: number;
}

export interface TutorialState {
  readonly active: ActiveTutorial | null;
  /** Set when a tutorial was completed, until the user closes the "done" card. */
  readonly finished: { readonly id: string; readonly title: string } | null;
  /** Tutorials created at runtime (e.g. by the assistant); not persisted. */
  readonly custom: readonly Tutorial[];
  readonly progress: Readonly<Record<string, TutorialProgress>>;
  /** First-run prompt: unknown until settings load, then shown at most once. */
  readonly offer: 'unknown' | 'show' | 'hidden';
}

export interface TutorialListItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly steps: number;
  readonly builtIn: boolean;
  readonly status: 'new' | 'completed' | 'dismissed';
}

export type TutorialEndReason = 'completed' | 'skipped' | 'stopped';

const controllers = new WeakMap<StudioSession, TutorialController>();

export class TutorialController {
  readonly store: StoreApi<TutorialState>;
  private readonly builtIns: readonly Tutorial[];
  private detach: (() => void) | null = null;
  private baseline: TutorialBaseline = {};
  /** False while a condition that was already true at entry (via Back) is still true. */
  private armed = true;
  private entering = false;
  private stepKey = 0;
  private disposed = false;

  /** The controller shared by the overlay, the toolbar menu and the tutorial tools. */
  static forSession(session: StudioSession): TutorialController {
    let controller = controllers.get(session);
    if (!controller) {
      controller = new TutorialController(session);
      controllers.set(session, controller);
      void controller.load();
    }
    return controller;
  }

  constructor(
    private readonly session: StudioSession,
    builtIns: readonly Tutorial[] = BUILTIN_TUTORIALS,
  ) {
    this.builtIns = builtIns;
    this.store = createStore<TutorialState>()(() => ({
      active: null,
      finished: null,
      custom: [],
      progress: {},
      offer: 'unknown',
    }));
  }

  /** Reads persisted progress and decides whether to show the first-run offer. */
  async load(): Promise<void> {
    const settings = this.session.platform.settingsRepository;
    try {
      const [progress, offer] = await Promise.all([
        settings.get<Record<string, TutorialProgress>>(PROGRESS_KEY),
        settings.get<string>(OFFER_KEY),
      ]);
      if (this.disposed) return;
      const saved = progress && typeof progress === 'object' ? progress : {};
      this.store.setState((s) => ({
        progress: { ...saved, ...s.progress },
        offer:
          s.offer !== 'unknown'
            ? s.offer
            : offer === undefined && Object.keys(saved).length === 0 && !s.active
              ? 'show'
              : 'hidden',
      }));
    } catch (error) {
      this.session.platform.logger.warn('Could not load tutorial progress', error);
      this.store.setState((s) => ({ offer: s.offer === 'unknown' ? 'hidden' : s.offer }));
    }
  }

  get builtInIds(): readonly string[] {
    return this.builtIns.map((t) => t.id);
  }

  get(id: string): { tutorial: Tutorial; builtIn: boolean } | undefined {
    const builtIn = this.builtIns.find((t) => t.id === id);
    if (builtIn) return { tutorial: builtIn, builtIn: true };
    const custom = this.store.getState().custom.find((t) => t.id === id);
    return custom ? { tutorial: custom, builtIn: false } : undefined;
  }

  list(): TutorialListItem[] {
    const { custom, progress } = this.store.getState();
    const item = (t: Tutorial, builtIn: boolean): TutorialListItem => ({
      id: t.id,
      title: t.title,
      description: t.description,
      steps: t.steps.length,
      builtIn,
      status: progress[t.id]?.status ?? 'new',
    });
    return [...this.builtIns.map((t) => item(t, true)), ...custom.map((t) => item(t, false))];
  }

  /** Adds (or replaces, by id) a runtime tutorial. The caller validates it first. */
  register(tutorial: Tutorial): void {
    if (this.builtIns.some((t) => t.id === tutorial.id))
      throw new Error(`"${tutorial.id}" is a built-in tutorial id`);
    this.store.setState((s) => ({
      custom: [...s.custom.filter((t) => t.id !== tutorial.id), tutorial],
    }));
  }

  /** Starts a tutorial by id (stopping any running one). Returns false for unknown ids. */
  start(id: string): boolean {
    const found = this.get(id);
    if (!found || this.disposed) return false;
    this.teardown();
    this.store.setState({
      active: { tutorial: found.tutorial, builtIn: found.builtIn, stepIndex: 0, stepKey: 0 },
      finished: null,
    });
    this.hideOffer('accepted');
    this.attach();
    this.enter(0, 'forward');
    return true;
  }

  /** Moves on regardless of the step's advance rule (the card's Next button). */
  next(): void {
    const active = this.store.getState().active;
    if (!active) return;
    this.advanceFrom(active.stepKey);
  }

  back(): void {
    const active = this.store.getState().active;
    if (!active || active.stepIndex === 0) return;
    this.enter(active.stepIndex - 1, 'back');
  }

  /** The user leaves the tour: built-in tours are remembered as dismissed (unless done). */
  skip(): void {
    this.end('skipped');
  }

  /** Stops without recording anything (e.g. the assistant stops it). */
  stop(): void {
    this.end('stopped');
  }

  dismissFinished(): void {
    this.store.setState({ finished: null });
  }

  /** First-run prompt answered without starting (Not now). */
  declineOffer(): void {
    this.hideOffer('dismissed');
  }

  /**
   * The overlay reports clicks inside Studio; `matches` tells whether the clicked element is
   * (inside) the element a target string resolves to. It is evaluated now, while the clicked
   * element still exists; the step advances on the next task so the click's own effect
   * (e.g. opening a dialog) happens first. Returns whether the click completes the step.
   */
  reportClick(matches: (target: string) => boolean): boolean {
    const active = this.store.getState().active;
    const step = active ? currentStep(active) : undefined;
    if (!active || !step || step.advance.type !== 'click') return false;
    const target = step.advance.target ?? step.target;
    if (!target || !matches(target)) return false;
    const { stepKey } = active;
    setTimeout(() => this.advanceFrom(stepKey), 0);
    return true;
  }

  dispose(): void {
    this.teardown();
    this.disposed = true;
    this.store.setState({ active: null });
  }

  // --- internals -----------------------------------------------------------------------------

  private attach(): void {
    const s = this.session;
    const evaluate = () => this.evaluate();
    const unsubs = [
      s.projectStore.subscribe(evaluate),
      s.uiStore.subscribe(evaluate),
      s.engineStore.subscribe(evaluate),
      s.midi.store.subscribe(evaluate),
      s.tools.onCall((event) => {
        const active = this.store.getState().active;
        const step = active ? currentStep(active) : undefined;
        if (!active || !step || !event.ok) return;
        if (step.advance.type === 'tool' && step.advance.name === event.name)
          this.advanceFrom(active.stepKey);
      }),
    ];
    this.detach = () => unsubs.forEach((u) => u());
  }

  private teardown(): void {
    this.detach?.();
    this.detach = null;
  }

  private enter(index: number, direction: 'forward' | 'back'): void {
    const active = this.store.getState().active;
    if (!active) return;
    const step = active.tutorial.steps[index];
    if (!step) return;
    const stepKey = ++this.stepKey;
    this.entering = true;
    try {
      this.store.setState({ active: { ...active, stepIndex: index, stepKey } });
      this.applyBefore(step);
      this.baseline = measure(snapshotSession(this.session));
    } finally {
      this.entering = false;
    }
    const satisfied = this.satisfied(step);
    // Re-entering a step with Back must not bounce forward because it is already done.
    this.armed = direction === 'forward' || !satisfied;
    if (this.armed && satisfied) this.advanceFrom(stepKey);
  }

  private applyBefore(step: TutorialStep): void {
    const before = step.before;
    if (!before) return;
    const { uiStore } = this.session;
    if (before.navigate) uiStore.setState((s) => navigate(s, before.navigate!));
    if (before.openPanel) {
      const panel = before.openPanel;
      uiStore.setState((s) => ({
        ...(s.view === 'projects' ? navigate(s, 'arrange') : s),
        panels: { ...s.panels, bottomOpen: true, bottomPanel: panel },
      }));
    }
  }

  private satisfied(step: TutorialStep): boolean {
    if (step.advance.type !== 'condition') return false;
    return evaluateCondition(step.advance.condition, snapshotSession(this.session), this.baseline);
  }

  private evaluate(): void {
    if (this.entering) return;
    const active = this.store.getState().active;
    const step = active ? currentStep(active) : undefined;
    if (!active || !step || step.advance.type !== 'condition') return;
    const ok = this.satisfied(step);
    if (!this.armed) {
      if (!ok) this.armed = true;
      return;
    }
    if (ok) this.advanceFrom(active.stepKey);
  }

  /** Advances only if `stepKey` is still current (ignores stale/double events). */
  private advanceFrom(stepKey: number): void {
    const active = this.store.getState().active;
    if (!active || active.stepKey !== stepKey) return;
    if (active.stepIndex + 1 < active.tutorial.steps.length)
      this.enter(active.stepIndex + 1, 'forward');
    else this.end('completed');
  }

  private end(reason: TutorialEndReason): void {
    const active = this.store.getState().active;
    this.teardown();
    if (!active) return;
    const { tutorial, builtIn } = active;
    this.store.setState({
      active: null,
      finished: reason === 'completed' ? { id: tutorial.id, title: tutorial.title } : null,
    });
    if (!builtIn || reason === 'stopped') return;
    const previous = this.store.getState().progress[tutorial.id];
    if (reason === 'skipped' && previous?.status === 'completed') return;
    const record: TutorialProgress = {
      status: reason === 'completed' ? 'completed' : 'dismissed',
      at: this.session.platform.now(),
    };
    this.store.setState((s) => ({ progress: { ...s.progress, [tutorial.id]: record } }));
    this.persist(PROGRESS_KEY, this.store.getState().progress);
  }

  private hideOffer(answer: 'accepted' | 'dismissed'): void {
    if (this.store.getState().offer === 'hidden') return;
    this.store.setState({ offer: 'hidden' });
    this.persist(OFFER_KEY, answer);
  }

  private persist(key: string, value: unknown): void {
    this.session.platform.settingsRepository
      .set(key, value)
      .catch((error: unknown) =>
        this.session.platform.logger.warn('Could not save tutorial progress', error),
      );
  }
}

export function currentStep(active: ActiveTutorial): TutorialStep | undefined {
  return active.tutorial.steps[active.stepIndex];
}
