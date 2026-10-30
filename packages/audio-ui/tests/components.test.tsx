import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ArmToggle,
  audioTaper,
  createMeterEmitter,
  linearTaper,
  meterFrameFromGains,
  MuteToggle,
  PanKnob,
  ParameterKnob,
  ParameterSliderField,
  parsePan,
  StereoMeter,
  VolumeFader,
} from '../src';

const sliderValue = (el: HTMLElement) => Number((el as HTMLInputElement).value);

describe('meterFrameFromGains', () => {
  it('converts linear peaks per channel to dBFS, floored at the meter bottom', () => {
    const frame = meterFrameFromGains([1, 0.5, 0]);
    expect(frame.levels[0]).toBeCloseTo(0, 6);
    expect(frame.levels[1]).toBeCloseTo(-6.02, 2);
    expect(frame.levels[2]).toBe(-60);
  });
});

describe('createMeterEmitter', () => {
  it('holds each peak, then lets it fall and reports when it has settled', () => {
    let now = 0;
    const source = createMeterEmitter({ holdMs: 1000, fallDbPerSecond: 20, now: () => now });
    expect(source.settled).toBe(true);
    source.emit({ levels: [-6, -12] });
    expect(source.getSnapshot().peaks).toEqual([-6, -12]);
    now = 500;
    source.emit({ levels: [-60, -60] });
    expect(source.getSnapshot().peaks).toEqual([-6, -12]);
    expect(source.settled).toBe(false);
    now = 1500;
    source.emit({ levels: [-60, -60] });
    expect(source.getSnapshot().peaks![0]).toBeCloseTo(-26, 6);
    now = 10_000;
    source.emit({ levels: [-60, -60] });
    expect(source.settled).toBe(true);
  });
});

describe('audioTaper', () => {
  it('puts unity at three quarters of the travel and round-trips', () => {
    const law = audioTaper(-60, 6);
    expect(law.toPosition(0)).toBeCloseTo(0.75, 9);
    expect(law.toPosition(-60)).toBe(0);
    expect(law.toPosition(6)).toBe(1);
    expect(law.toValue(law.toPosition(-18))).toBeCloseTo(-18, 9);
  });
});

describe('VolumeFader', () => {
  it('reports dB values and announces the formatted gain', () => {
    const onChange = vi.fn();
    render(
      <VolumeFader
        label="Keys volume"
        value={-6}
        min={-60}
        max={6}
        taper={linearTaper(-60, 6)}
        format={(db) => `${db.toFixed(1)} dB`}
        onChange={onChange}
      />,
    );
    const thumb = screen.getByRole('slider', { name: 'Keys volume' });
    expect(thumb).toHaveAttribute('aria-valuetext', '-6.0 dB');
    expect(sliderValue(thumb)).toBeCloseTo(54 / 66, 3);
    fireEvent.change(thumb, { target: { value: String(60 / 66) } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('applies a typed value from the readout', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<VolumeFader label="Master" value={0} onChange={onChange} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByRole('button', { name: '0.0 dB, type Master value' }));
    const field = screen.getByRole('textbox', { name: 'Master value' });
    fireEvent.change(field, { target: { value: '-12 dB' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(-12);
    expect(onCommit).toHaveBeenCalledWith(-12);
  });
});

describe('ParameterKnob', () => {
  it('is a slider named by its caption and follows the value', () => {
    function Harness() {
      const [value, setValue] = useState(0.5);
      return <ParameterKnob label="Cutoff" value={value} step={0.1} onChange={setValue} />;
    }
    render(<Harness />);
    const dial = screen.getByRole('slider', { name: 'Cutoff' });
    expect(sliderValue(dial)).toBeCloseTo(0.5, 6);
    fireEvent.change(dial, { target: { value: '0.6' } });
    expect(sliderValue(dial)).toBeCloseTo(0.6, 6);
  });

  it('keeps the accessible name when the caption is hidden and reads pan as L/C/R', () => {
    render(<PanKnob label="Bass pan" hideLabel value={-0.3} onChange={() => {}} />);
    const dial = screen.getByRole('slider', { name: 'Bass pan' });
    expect(dial).toHaveAttribute('aria-valuetext', 'L30');
    expect(parsePan('R15')).toBeCloseTo(0.15, 9);
    expect(parsePan('c')).toBe(0);
    expect(parsePan('left')).toBeNull();
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
  it('has a meter per channel and latches clipping until the meter is clicked', () => {
    const source = createMeterEmitter();
    render(<StereoMeter label="Master level" source={source} />);
    const left = screen.getByRole('meter', { name: 'Master level, left' });
    expect(screen.getByRole('meter', { name: 'Master level, right' })).toBeInTheDocument();
    act(() => source.emit(meterFrameFromGains([1, 0.5])));
    expect(left).toHaveAttribute('data-clipped');
    fireEvent.click(left);
    expect(left).not.toHaveAttribute('data-clipped');
  });

  it('renders silent without a source', () => {
    render(<StereoMeter label="Keys level" source={null} showClip={false} />);
    expect(screen.getAllByRole('meter')).toHaveLength(2);
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
