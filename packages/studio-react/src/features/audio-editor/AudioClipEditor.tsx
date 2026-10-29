import { framesToSeconds, type AudioClip } from '@studio/domain';
import { Knob, ToggleButton } from '@studio/ui';
import { Repeat } from 'lucide-react';
import { useRef } from 'react';
import { SEPARATOR, StudioContextMenu } from '../../components/context-menu';
import { formatDb } from '../../lib/format';
import { useProjectState, useSession } from '../../session/context';

/** Non-destructive audio clip properties: gain, fades and looping. */
export function AudioClipEditor({ clip }: { clip: AudioClip }) {
  const session = useSession();
  const asset = useProjectState((s) => s.project.assets[clip.assetId]);
  const gesture = useRef(0);
  const sampleRate = asset?.sampleRate ?? 48000;
  const maxFadeMs = Math.max(0, framesToSeconds(clip.lengthFrames, sampleRate) * 1000);
  const updateClip = (
    patch: {
      gainDb?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      loopLengthFrames?: number | null;
    },
    label: string,
  ) =>
    session.history.execute(
      { type: 'clip.updateAudio', clipId: clip.id, patch },
      { label, coalesceKey: `clip:${clip.id}:${label}:${gesture.current}` },
    );
  const end = () => {
    gesture.current += 1;
  };

  const resolveMenu = () => [
    {
      id: 'audio-loop',
      label: 'Loop clip',
      checked: clip.loopLengthFrames !== undefined,
      onSelect: () => session.edits.setClipsLooping([clip.id], clip.loopLengthFrames === undefined),
    },
    {
      id: 'audio-mute',
      label: 'Mute clip',
      checked: clip.muted,
      onSelect: () => session.edits.setClipsMuted([clip.id], !clip.muted),
    },
    SEPARATOR,
    {
      id: 'audio-reset-gain',
      label: 'Reset gain (0 dB)',
      disabled: clip.gainDb === 0,
      onSelect: () =>
        session.history.execute(
          { type: 'clip.updateAudio', clipId: clip.id, patch: { gainDb: 0 } },
          { label: 'Reset Clip Gain' },
        ),
    },
    {
      id: 'audio-remove-fades',
      label: 'Remove fades',
      disabled: clip.fadeInFrames === 0 && clip.fadeOutFrames === 0,
      onSelect: () =>
        session.history.execute(
          {
            type: 'clip.updateAudio',
            clipId: clip.id,
            patch: { fadeInFrames: 0, fadeOutFrames: 0 },
          },
          { label: 'Remove Fades' },
        ),
    },
  ];

  return (
    <StudioContextMenu target="audio-clip" resolve={resolveMenu}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3" data-testid="audio-clip-editor">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold">{clip.name}</span>
          <span className="text-[11px] text-text-faint">
            {asset
              ? `${asset.channels === 1 ? 'Mono' : 'Stereo'} · ${(asset.sampleRate / 1000).toFixed(1)} kHz · ${framesToSeconds(asset.frames, asset.sampleRate).toFixed(2)} s source`
              : 'Missing source audio'}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-5">
          <Knob
            label="Clip gain"
            min={-36}
            max={12}
            step={0.1}
            defaultValue={0}
            value={clip.gainDb}
            formatValue={(v) => `${formatDb(v)} dB`}
            onChange={(gainDb) => updateClip({ gainDb }, 'Clip Gain')}
            onChangeEnd={end}
          />
          <Knob
            label="Fade in"
            min={0}
            max={Math.max(1, maxFadeMs)}
            step={1}
            defaultValue={0}
            value={framesToSeconds(clip.fadeInFrames, sampleRate) * 1000}
            formatValue={(v) => `${Math.round(v)} ms`}
            onChange={(ms) =>
              updateClip({ fadeInFrames: Math.round((ms / 1000) * sampleRate) }, 'Fade In')
            }
            onChangeEnd={end}
          />
          <Knob
            label="Fade out"
            min={0}
            max={Math.max(1, maxFadeMs)}
            step={1}
            defaultValue={0}
            value={framesToSeconds(clip.fadeOutFrames, sampleRate) * 1000}
            formatValue={(v) => `${Math.round(v)} ms`}
            onChange={(ms) =>
              updateClip({ fadeOutFrames: Math.round((ms / 1000) * sampleRate) }, 'Fade Out')
            }
            onChangeEnd={end}
          />
          <ToggleButton
            label="Loop clip"
            tone="accent"
            pressed={clip.loopLengthFrames !== undefined}
            icon={<Repeat />}
            onPressedChange={(on) =>
              updateClip(
                { loopLengthFrames: on ? clip.lengthFrames : null },
                on ? 'Loop Clip' : 'Unloop Clip',
              )
            }
          />
        </div>
        <p className="text-[11px] text-text-faint">
          Edits are non-destructive: the source audio is never modified. Trim and split clips in the
          arrangement.
        </p>
      </div>
    </StudioContextMenu>
  );
}
