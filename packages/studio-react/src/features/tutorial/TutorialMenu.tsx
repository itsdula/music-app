/** Toolbar entry for tutorials: list with completion state, start/restart, stop, ask the AI. */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@studio/ui';
import { CircleCheck, GraduationCap, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useSession } from '../../session/context';
import { useTutorialController, useTutorialState } from './use-tutorial';

export function TutorialMenu() {
  const session = useSession();
  const controller = useTutorialController();
  const progress = useTutorialState((s) => s.progress);
  const custom = useTutorialState((s) => s.custom);
  const activeId = useTutorialState((s) => s.active?.tutorial.id ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- list() reads progress and custom
  const items = useMemo(() => controller.list(), [controller, progress, custom]);
  /** Set when an item starts a tour, so the menu doesn't pull focus back from the card. */
  const started = useRef(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label="Tutorials"
          icon={<GraduationCap />}
          variant={activeId ? 'secondary' : 'ghost'}
          data-testid="tutorial-menu"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72"
        onCloseAutoFocus={(event) => {
          if (started.current) event.preventDefault();
          started.current = false;
        }}
      >
        <DropdownMenuLabel>Tutorials</DropdownMenuLabel>
        {items.map((item) => {
          const running = item.id === activeId;
          const done = item.status === 'completed';
          return (
            <DropdownMenuItem
              key={item.id}
              icon={done ? <CircleCheck /> : running ? <RotateCcw /> : <Play />}
              className="h-auto py-1.5"
              onSelect={() => {
                started.current = controller.start(item.id);
              }}
              data-testid={`tutorial-item-${item.id}`}
              data-status={running ? 'running' : item.status}
            >
              <span className="flex flex-col">
                <span className="truncate">{item.title}</span>
                <span className="truncate text-[11px] text-text-muted">
                  {running
                    ? 'Running · select to restart'
                    : done
                      ? `Completed · select to restart · ${item.steps} steps`
                      : `${item.builtIn ? '' : 'From the assistant · '}${item.steps} steps`}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
        {activeId && (
          <DropdownMenuItem
            icon={<Square />}
            onSelect={() => controller.stop()}
            data-testid="tutorial-stop"
          >
            Stop the current tutorial
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Sparkles />}
          className="h-auto py-1.5"
          onSelect={() => session.uiStore.setState((s) => ({ ...s, assistantOpen: true }))}
          data-testid="tutorial-ask-assistant"
        >
          <span className="flex flex-col">
            <span>Ask the assistant for a tutorial</span>
            <span className="text-[11px] whitespace-normal text-text-muted">
              e.g. “Show me how to add reverb to my vocals” — it builds a guided tour for you.
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
