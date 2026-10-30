import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ArmToggle,
  createFrameEmitter,
  linearTaper,
  meterFrameFromGains,
  MuteToggle,
  PanKnob,
  ParameterKnob,
  ParameterSliderField,
  StereoMeter,
  VolumeFader,
  type MeterFrame,
} from '../src';

describe('meterFrameFromGains', () => {
  it('converts linear peak and RMS per channel to dBFS', () => {
    const frame = meterFrameFromGains([1, 0.5], [0.1, 0]);
    expect(frame.channels).toHaveLength(2);
    expect(frame.channels[0]!.peakDb).toBeCloseTo(0, 6);
    expect(frame.channels[1]!.peakDb).toBeCloseTo(-6.02, 2);
    expect(frame.channels[0]!.rmsDb).toBeCloseTo(-20, 6);
    expect(frame.channels[1]!.rmsDb).toBe(Number.NEGATIVE_INFINITY);
  });

  it('omits RMS when the engine does not report it', () => {
    expect(Object.keys(meterFrameFromGains([0.25]).channels[0]!)).toEqual(['peakDb']);
  });
});

describe('VolumeFader', () => {
  it('reports dB values and exposes the taper position to assistive technology', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <VolumeFader
        label="Keys volume"
        value={-6}
        min={-60}
        max={6}
        taper={linearTaper(-60, 6)}
        format={(db) => `${db.toFixed(1)} dB`}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );
    const thumb = screen.getByRole('slider', { name: 'Keys volume' });
    expect(thumb).toHaveAttribute('aria-valuetext', '-6.0 dB');
    expect(Number(thumb.getAttribute('aria-valuenow'))).toBeCloseTo(54 / 66, 3);
    fireEvent.keyDown(thumb, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(-5.5);
    expect(onCommit).toHaveBeenCalledWith(-5.5);
  });
});

describe('ParameterKnob', () => {
  it('is a slider named by its caption and steps with the keyboard', () => {
    function Harness() {
      const [value, setValue] = useState(0.5);
      return <ParameterKnob label="Cutoff" value={value} step={0.1} onChange={setValue} />;
    }
    render(<Harness />);
    const dial = screen.getByRole('slider', { name: 'Cutoff' });
    fireEvent.keyDown(dial, { key: 'ArrowUp' });
    expect(Number(dial.getAttribute('aria-valuenow'))).toBeCloseTo(0.6, 6);
    fireEvent.keyDown(dial, { key: 'Home' });
    expect(dial).toHaveAttribute('aria-valuenow', '0');
  });

  it('keeps the accessible name when the caption is hidden', () => {
    render(<PanKnob label="Bass pan" hideLabel value={-0.3} onChange={() => {}} />);
    const dial = screen.getByRole('slider', { name: 'Bass pan' });
    expect(dial).toHaveAttribute('aria-valuetext', 'L30');
  });
});

describe('ParameterSliderField', () => {
  it('labels the slider, shows the formatted value and describes it with the hint', () => {
    render(
      <ParameterSliderField
        label="Auto Tune"
        value={0.25}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        hint="How strongly notes snap to the key"
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Auto Tune' });
    expect(slider).toHaveAccessibleDescription('How strongly notes snap to the key');
    expect(screen.getByText('25%')).toBeInTheDocument();
  });
});

describe('StereoMeter', () => {
  it('subscribes to its frame source and lights the clip indicator at full scale', () => {
    const source = createFrameEmitter<MeterFrame>();
    render(<StereoMeter label="Master level" source={source} />);
    const meter = screen.getByRole('meter', { name: 'Master level' });
    const channels = meter.querySelectorAll<HTMLElement>('[data-slot="level-meter-channel"]');
    expect(channels).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Clip indicator' })).toBeInTheDocument();
    act(() => source.emit(meterFrameFromGains([1, 0.5])));
    const clip = screen.getByRole('button', { name: 'Clipping. Reset clip indicator' });
    fireEvent.click(clip);
    expect(screen.getByRole('button', { name: 'Clip indicator' })).toBeInTheDocument();
  });

  it('can leave out the clip light', () => {
    render(<StereoMeter label="Keys level" source={null} showClip={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('channel toggles', () => {
  it('toggle aria-pressed and report the new state', () => {
    const onMute = vi.fn();
    render(
      <>
        <MuteToggle pressed={false} onPressedChange={onMute}>
          M
        </MuteToggle>
        <ArmToggle pressed>●</ArmToggle>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(onMute).toHaveBeenCalledWith(true, expect.anything());
    expect(screen.getByRole('button', { name: 'Arm for recording' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
