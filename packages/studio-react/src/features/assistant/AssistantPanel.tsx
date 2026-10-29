/**
 * Right-side AI assistant panel (shown when `ui.assistantOpen`): transcript with tool-call
 * chips, suggestions, composer, stop/retry/clear. The conversation logic lives in
 * `conversation.ts`; this component only renders its store and forwards user actions.
 */
import { Button, cn, IconButton, Spinner, VisuallyHidden } from '@studio/ui';
import {
  ArrowUp,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Eraser,
  RotateCcw,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { useProjectState, useSession } from '../../session/context';
import type { StudioSession } from '../../session/studio-session';
import {
  getConversation,
  NOT_CONFIGURED_MESSAGE,
  type AssistantConversation,
  type TranscriptItem,
} from './conversation';
import { Markdown } from './Markdown';

export const ASSISTANT_SUGGESTIONS: readonly string[] = [
  'Make a 4-bar house beat',
  'Add a chord progression in A minor',
  'Write a bass line that fits my chords',
  'Take me to the mixer',
  'Set the tempo to 124 BPM',
  'Add reverb to the keys',
];

const PANEL_WIDTH = 360;

function lastAnnouncement(items: readonly TranscriptItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'assistant') return `Assistant: ${item.text}`;
    if (item.kind === 'user') return '';
  }
  return '';
}

/**
 * The conversation to show: the open project's, except that a running conversation stays on
 * screen until it finishes (it may itself have switched projects, and then follows along).
 */
function useShownConversation(session: StudioSession, projectId: string): AssistantConversation {
  const [shown, setShown] = useState(() => getConversation(session, projectId));
  useEffect(() => {
    const update = () => {
      if (shown.state.status === 'running') return;
      const next = getConversation(session, projectId);
      if (next !== shown) setShown(next);
    };
    const unsubscribe = shown.store.subscribe(update);
    update();
    return unsubscribe;
  }, [session, projectId, shown]);
  return shown;
}

export function AssistantPanel() {
  const session = useSession();
  const projectId = useProjectState((s) => s.project.id);
  const conversation = useShownConversation(session, projectId);
  const transport = session.platform.assistant;
  const close = () => session.uiStore.setState((s) => ({ ...s, assistantOpen: false }));
  const titleId = useId();

  return (
    <aside
      id="studio-assistant"
      aria-labelledby={titleId}
      data-testid="assistant-panel"
      className="flex shrink-0 flex-col border-l border-line bg-surface-1"
      style={{ width: PANEL_WIDTH }}
    >
      <ConversationView
        key={conversation.id}
        conversation={conversation}
        configured={Boolean(transport)}
        transportLabel={transport?.label ?? null}
        titleId={titleId}
        onClose={close}
      />
    </aside>
  );
}

function ConversationView({
  conversation,
  configured,
  transportLabel,
  titleId,
  onClose,
}: {
  conversation: AssistantConversation;
  configured: boolean;
  transportLabel: string | null;
  titleId: string;
  onClose: () => void;
}) {
  const { items, status, error } = useStore(conversation.store);
  const running = status === 'running';
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [items.length, running, error]);

  const send = (text: string) => {
    if (!configured || running || !text.trim()) return;
    setDraft('');
    void conversation.send(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    } else if (e.key === 'Escape' && running) {
      e.preventDefault();
      conversation.abort();
    }
  };

  const showNotConfigured = !configured || error?.code === 'not-configured';

  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Sparkles className="size-4 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[12px] font-semibold text-text">
            AI assistant
          </h2>
          {transportLabel && (
            <p className="truncate text-[10px] text-text-faint" title={transportLabel}>
              {transportLabel}
            </p>
          )}
        </div>
        <IconButton
          label="Clear chat"
          icon={<Eraser />}
          size="sm"
          disabled={items.length === 0}
          onClick={() => conversation.clear()}
          data-testid="assistant-clear"
        />
        <IconButton label="Close assistant" icon={<X />} size="sm" onClick={onClose} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="assistant-transcript">
        {showNotConfigured && (
          <div
            role="alert"
            data-testid="assistant-not-configured"
            className="mb-3 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[12px] text-text"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p>{NOT_CONFIGURED_MESSAGE}</p>
          </div>
        )}
        {items.length === 0 && !showNotConfigured && (
          <EmptyState disabled={!configured || running} onPick={send} />
        )}
        <ol aria-label="Conversation" className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <TranscriptEntry item={item} />
            </li>
          ))}
        </ol>
        {running && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-text-muted">
            <Spinner size="sm" label="Assistant is working" />
            <span aria-hidden>Working…</span>
          </div>
        )}
        {error && error.code !== 'not-configured' && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-record/40 bg-record/10 p-2.5 text-[12px] text-text"
            data-testid="assistant-error"
          >
            <p className="flex gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-record" aria-hidden />
              <span>{error.message}</span>
            </p>
            <Button
              size="sm"
              className="mt-2"
              icon={<RotateCcw />}
              onClick={() => void conversation.retry()}
              data-testid="assistant-retry"
            >
              Retry
            </Button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <VisuallyHidden>
        <div role="status" aria-live="polite" aria-atomic="true" data-testid="assistant-live">
          {running ? '' : lastAnnouncement(items)}
        </div>
      </VisuallyHidden>

      <form
        className="shrink-0 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Message the assistant
        </label>
        <div className="flex items-end gap-1.5 rounded-md border border-line bg-surface-2 p-1.5 focus-within:border-accent">
          <textarea
            id={inputId}
            ref={inputRef}
            data-testid="assistant-input"
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1 text-[12px] text-text outline-none placeholder:text-text-faint disabled:opacity-50"
            rows={2}
            placeholder={configured ? 'Ask for a beat, chords, a melody…' : 'Assistant unavailable'}
            value={draft}
            disabled={!configured}
            aria-describedby={hintId}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {running ? (
            <IconButton
              label="Stop"
              icon={<Square />}
              variant="danger"
              onClick={() => conversation.abort()}
              data-testid="assistant-stop"
            />
          ) : (
            <IconButton
              type="submit"
              label="Send"
              icon={<ArrowUp />}
              variant="primary"
              disabled={!configured || !draft.trim()}
              data-testid="assistant-send"
            />
          )}
        </div>
        <p id={hintId} className="mt-1.5 px-1 text-[10px] text-text-faint">
          Enter to send, Shift+Enter for a new line. Every change can be reverted with Undo.
        </p>
      </form>
    </>
  );
}

function EmptyState({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
  return (
    <div className="mb-3">
      <p className="text-[12px] text-text-muted">
        I can build parts for your song, change sounds and take you around Studio. Try:
      </p>
      <ul aria-label="Suggestions" className="mt-2 flex flex-wrap gap-1.5">
        {ASSISTANT_SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              data-testid="assistant-suggestion"
              className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-left text-[11px] text-text hover:border-accent hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TranscriptEntry({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex justify-end" data-testid="assistant-message" data-role="user">
          <VisuallyHidden>You said:</VisuallyHidden>
          <p className="max-w-[85%] rounded-lg rounded-br-sm bg-accent/20 px-2.5 py-1.5 text-[12px] whitespace-pre-wrap text-text">
            {item.text}
          </p>
        </div>
      );
    case 'assistant':
      return (
        <div
          data-testid="assistant-message"
          data-role="assistant"
          className="text-[12px] text-text"
        >
          <VisuallyHidden>Assistant:</VisuallyHidden>
          <Markdown source={item.text} />
        </div>
      );
    case 'notice':
      return (
        <p
          className={cn(
            'text-[11px] italic',
            item.tone === 'warning' ? 'text-warning' : 'text-text-muted',
          )}
          data-testid="assistant-notice"
        >
          {item.text}
        </p>
      );
    case 'tool':
      return <ToolCallChip item={item} />;
  }
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

function ToolCallChip({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const statusLabel =
    item.status === 'running'
      ? 'running'
      : item.status === 'ok'
        ? 'done'
        : item.status === 'error'
          ? 'failed'
          : 'skipped';
  return (
    <div
      data-testid="assistant-tool-call"
      data-tool={item.name}
      data-status={item.status}
      className="rounded-md border border-line bg-surface-2/60 text-[11px]"
    >
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-3 shrink-0" aria-hidden />
        )}
        <span className="flex-1 truncate">
          <span className="font-medium text-text">{item.title}</span>{' '}
          <code className="text-text-faint">{item.name}</code>
        </span>
        <span className="sr-only">{statusLabel}</span>
        {item.status === 'running' && <Spinner size="sm" label="Running" />}
        {item.status === 'ok' && <Check className="size-3.5 text-success" aria-hidden />}
        {item.status === 'error' && <CircleAlert className="size-3.5 text-record" aria-hidden />}
        {item.status === 'skipped' && <Ban className="size-3.5 text-text-faint" aria-hidden />}
      </button>
      {item.deleted && (
        <p className="border-t border-line px-2 py-1 text-warning" data-testid="assistant-deletion">
          {item.deleted} Undo restores it.
        </p>
      )}
      {item.status === 'error' && item.error && !open && (
        <p className="border-t border-line px-2 py-1 text-record">{item.error}</p>
      )}
      {open && (
        <div id={detailsId} className="space-y-1.5 border-t border-line px-2 py-1.5">
          <div>
            <div className="text-[10px] font-semibold tracking-wide text-text-faint uppercase">
              Input
            </div>
            <pre className="max-h-48 overflow-auto rounded bg-surface-0 p-1.5 font-mono text-[10px] whitespace-pre-wrap text-text">
              {pretty(item.input)}
            </pre>
          </div>
          {(item.status === 'ok' || item.status === 'error') && (
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-text-faint uppercase">
                {item.status === 'ok' ? 'Result' : 'Error'}
              </div>
              <pre className="max-h-48 overflow-auto rounded bg-surface-0 p-1.5 font-mono text-[10px] whitespace-pre-wrap text-text">
                {item.status === 'ok' ? pretty(item.result) : item.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
