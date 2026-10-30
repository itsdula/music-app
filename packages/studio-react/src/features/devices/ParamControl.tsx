import { ParameterKnob } from '@studio/audio-ui';
import type { Command } from '@studio/commands';
import {
  denormalizeParam,
  formatParamValue,
  normalizeParam,
  type ParamSpec,
  type ParameterAddress,
} from '@studio/domain';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  SegmentedControl,
} from '@studio/ui';
import type { ReactElement } from 'react';
import { useRef } from 'react';
import { parseParamText } from '../../lib/param-text';
import { useSession } from '../../session/context';

/**
 * Edits one ParamSpec-described value. Continuous params use a Knob in normalized space
 * (so log/dB curves feel right); enumerations use a segmented control. Each drag gesture
 * becomes a single undo entry via a gesture-scoped coalesce key.
 */
export function ParamControl({
  spec,
  value,
  command,
  gestureKey,
  size = 'md',
  address,
}: {
  spec: ParamSpec;
  value: number;
  command: (value: number) => Command;
  gestureKey: string;
  size?: 'sm' | 'md';
  /** When set, the control offers "MIDI Learn" in its context menu. */
  address?: ParameterAddress;
}) {
  const session = useSession();
  const gesture = useRef(0);
  const commit = (v: number) =>
    session.history.execute(command(v), {
      label: `Change ${spec.label}`,
      coalesceKey: `${gestureKey}:${gesture.current}`,
    });

  if (spec.options && spec.options.length <= 5) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
          {spec.label}
        </span>
        <SegmentedControl
          label={spec.label}
          size="sm"
          value={String(Math.round(value))}
          onChange={(v) => {
            gesture.current += 1;
            commit(Number(v));
          }}
          options={spec.options.map((o) => ({ value: String(o.value), label: o.label }))}
        />
      </div>
    );
  }

  const bipolar = spec.min < 0 && spec.max > 0 && spec.curve === 'linear';
  return withLearn(
    address,
    session.midi.startLearn.bind(session.midi),
    <ParameterKnob
      label={spec.label}
      size={size === 'sm' ? 'sm' : 'default'}
      min={0}
      max={1}
      step={spec.step ? spec.step / (spec.max - spec.min) : 0.001}
      fineStep={0.0002}
      resetValue={normalizeParam(spec, spec.default)}
      value={normalizeParam(spec, value)}
      {...(bipolar ? { origin: normalizeParam(spec, 0) } : {})}
      format={(n) => formatParamValue(spec, denormalizeParam(spec, n))}
      parse={(text) => parseParamText(spec, text)}
      onChange={(n) => commit(denormalizeParam(spec, n))}
      onCommit={() => {
        gesture.current += 1;
      }}
    />,
  );
}

/** Wraps a control with a context menu offering MIDI Learn for its parameter. */
export function withLearn(
  address: ParameterAddress | undefined,
  startLearn: (target: { kind: 'parameter'; address: ParameterAddress }) => void,
  control: ReactElement,
): ReactElement {
  if (!address) return control;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>{control}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => startLearn({ kind: 'parameter', address })}>
          MIDI Learn…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
