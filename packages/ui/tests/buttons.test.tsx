import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton, StudioPortalProvider, ToggleButton } from '../src';

describe('Button', () => {
  it('defaults to type="button" and renders the icon', () => {
    render(<Button icon={<svg data-testid="icon" />}>Export</Button>);
    const button = screen.getByRole('button', { name: 'Export' });
    expect(button).toHaveAttribute('type', 'button');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('uses the label as accessible name', () => {
    render(<IconButton label="Play" icon={<svg aria-hidden="true" />} shortcut="Space" />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('requires a label at the type level', () => {
    // @ts-expect-error -- `label` is required
    const element = <IconButton icon={<svg />} />;
    expect(element).toBeTruthy();
  });

  it('shows its label as a tooltip portaled into the Studio container', async () => {
    const container = document.createElement('div');
    container.className = 'studio-root';
    document.body.append(container);
    render(
      <StudioPortalProvider container={container}>
        <IconButton label="Record" icon={<svg aria-hidden="true" />} shortcut="R" />
      </StudioPortalProvider>,
    );
    act(() => screen.getByRole('button', { name: 'Record' }).focus());
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Record');
    expect(container).toContainElement(tooltip);
    expect(container.querySelector('kbd')).toHaveTextContent('R');
    container.remove();
  });
});

describe('ToggleButton', () => {
  function Harness({ onSpy }: { onSpy: (v: boolean) => void }) {
    const [pressed, setPressed] = useState(false);
    return (
      <ToggleButton
        label="Solo"
        tone="warning"
        pressed={pressed}
        onPressedChange={(next) => {
          onSpy(next);
          setPressed(next);
        }}
      >
        S
      </ToggleButton>
    );
  }

  it('reflects state with aria-pressed and toggles on click / keyboard activation', () => {
    const spy = vi.fn<(v: boolean) => void>();
    render(<Harness onSpy={spy} />);
    const button = screen.getByRole('button', { name: 'Solo' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(spy).toHaveBeenLastCalledWith(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(spy).toHaveBeenLastCalledWith(false);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses visible text as name when no label is given', () => {
    render(
      <ToggleButton pressed onPressedChange={() => {}} tone="accent">
        Loop
      </ToggleButton>,
    );
    expect(screen.getByRole('button', { name: 'Loop', pressed: true })).toBeInTheDocument();
  });
});
