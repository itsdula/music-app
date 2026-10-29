import {
  EFFECT_KINDS,
  EFFECT_LABELS,
  EFFECT_PARAM_SPECS,
  type EffectSlot,
  type TrackId,
} from '@studio/domain';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Switch,
} from '@studio/ui';
import { ChevronLeft, ChevronRight, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useSession } from '../../session/context';
import { ParamControl } from './ParamControl';

function EffectUnit({
  target,
  slot,
  index,
  count,
}: {
  target: TrackId | 'master';
  slot: EffectSlot;
  index: number;
  count: number;
}) {
  const session = useSession();
  const specs = EFFECT_PARAM_SPECS[slot.kind];
  return (
    <section
      className={`flex shrink-0 flex-col gap-2 rounded-lg border p-3 ${slot.bypass ? 'border-line bg-surface-1 opacity-70' : 'border-line bg-surface-2'}`}
      aria-label={`${EFFECT_LABELS[slot.kind]} effect`}
      data-testid="effect-unit"
      data-effect-kind={slot.kind}
    >
      <header className="flex items-center gap-1.5">
        <Switch
          label={`${EFFECT_LABELS[slot.kind]} on`}
          checked={!slot.bypass}
          onCheckedChange={(on) =>
            session.history.execute(
              { type: 'effect.setBypass', target, effectId: slot.id, bypass: !on },
              { label: on ? 'Enable Effect' : 'Bypass Effect' },
            )
          }
        />
        <h4 className="flex-1 text-[12px] font-semibold">{EFFECT_LABELS[slot.kind]}</h4>
        <IconButton
          label="Move left"
          icon={<ChevronLeft />}
          size="sm"
          variant="ghost"
          disabled={index === 0}
          onClick={() =>
            session.history.execute(
              { type: 'effect.move', target, effectId: slot.id, toIndex: index - 1 },
              { label: 'Reorder Effect' },
            )
          }
        />
        <IconButton
          label="Move right"
          icon={<ChevronRight />}
          size="sm"
          variant="ghost"
          disabled={index === count - 1}
          onClick={() =>
            session.history.execute(
              { type: 'effect.move', target, effectId: slot.id, toIndex: index + 1 },
              { label: 'Reorder Effect' },
            )
          }
        />
        <IconButton
          label="Remove effect"
          icon={<Trash2 />}
          size="sm"
          variant="ghost"
          onClick={() =>
            session.history.execute(
              { type: 'effect.remove', target, effectId: slot.id },
              { label: 'Remove Effect' },
            )
          }
        />
      </header>
      <div className="flex flex-wrap items-end gap-3">
        {specs.map((spec) => (
          <ParamControl
            key={spec.id}
            spec={spec}
            value={slot.params[spec.id] ?? spec.default}
            gestureKey={`fx:${slot.id}:${spec.id}`}
            address={{ scope: 'effect', trackId: target, effectId: slot.id, param: spec.id }}
            size="sm"
            command={(v) => ({
              type: 'effect.setParams',
              target,
              effectId: slot.id,
              params: { [spec.id]: v },
            })}
          />
        ))}
      </div>
    </section>
  );
}

export function EffectChain({
  target,
  effects,
}: {
  target: TrackId | 'master';
  effects: readonly EffectSlot[];
}) {
  const session = useSession();
  return (
    <div className="flex min-w-0 items-stretch gap-2" data-testid="effect-chain">
      {effects.map((slot, i) => (
        <EffectUnit key={slot.id} target={target} slot={slot} index={i} count={effects.length} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-[11px] text-text-muted hover:border-accent hover:text-text"
            aria-label="Add effect"
            data-testid="add-effect"
          >
            <Plus className="size-4" aria-hidden />
            Add effect
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {EFFECT_KINDS.map((kind) => (
            <DropdownMenuItem
              key={kind}
              icon={<SlidersHorizontal />}
              onSelect={() => session.edits.addEffect(target, kind)}
            >
              {EFFECT_LABELS[kind]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
