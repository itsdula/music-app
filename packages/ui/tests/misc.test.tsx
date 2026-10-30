import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressBar,
  Select,
  Spinner,
  StudioPortalProvider,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  VisuallyHidden,
  cn,
} from '../src';

let portal: HTMLDivElement;

beforeEach(() => {
  portal = document.createElement('div');
  portal.className = 'studio-root';
  document.body.append(portal);
});

afterEach(() => {
  portal.remove();
});

describe('overlays portal into the StudioPortalProvider container', () => {
  it('Dialog', () => {
    render(
      <StudioPortalProvider container={portal}>
        <Dialog open onOpenChange={() => {}}>
          <DialogContent title="Export project" description="Render to WAV">
            body
          </DialogContent>
        </Dialog>
      </StudioPortalProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Export project' });
    expect(portal).toContainElement(dialog);
    expect(dialog).toHaveAccessibleDescription('Render to WAV');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('DropdownMenu', () => {
    const onSelect = vi.fn();
    render(
      <StudioPortalProvider container={portal}>
        <DropdownMenu open onOpenChange={() => {}}>
          <DropdownMenuTrigger asChild>
            <Button>File</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem shortcut="⌘S" onSelect={onSelect}>
              Save
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </StudioPortalProvider>,
    );
    const item = screen.getByRole('menuitem', { name: /Save/ });
    expect(portal).toContainElement(item);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
  });

  it('Popover', () => {
    render(
      <StudioPortalProvider container={portal}>
        <Popover open>
          <PopoverTrigger asChild>
            <Button>Open</Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Details">content</PopoverContent>
        </Popover>
      </StudioPortalProvider>,
    );
    expect(portal).toHaveTextContent('content');
  });

  it('falls back to document.body without a provider', () => {
    render(
      <Dialog open>
        <DialogContent title="Hello" hideTitle />
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Hello' })).toBeInTheDocument();
  });
});

describe('other primitives', () => {
  it('Select exposes an accessible trigger', () => {
    render(
      <Select
        label="Input device"
        value="a"
        onValueChange={() => {}}
        options={[
          { value: 'a', label: 'Built-in mic' },
          { value: 'b', label: 'USB interface' },
        ]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Input device' })).toHaveTextContent(
      'Built-in mic',
    );
  });

  it('Switch toggles and is labelled', () => {
    const onChange = vi.fn();
    render(<Switch label="Snap to grid" checked={false} onCheckedChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Snap to grid' });
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Tabs switch on click', () => {
    const onValueChange = vi.fn();
    render(
      <Tabs value="mixer" onValueChange={onValueChange}>
        <TabsList aria-label="Panels">
          <TabsTrigger value="mixer">Mixer</TabsTrigger>
          <TabsTrigger value="editor">Editor</TabsTrigger>
        </TabsList>
        <TabsContent value="mixer">Mixer panel</TabsContent>
        <TabsContent value="editor">Editor panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: 'Mixer' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Editor' }), { button: 0 });
    expect(onValueChange).toHaveBeenCalledWith('editor');
  });

  it('ProgressBar reports determinate and indeterminate states', () => {
    const { rerender } = render(<ProgressBar label="Rendering" value={0.4} />);
    const bar = screen.getByRole('progressbar', { name: 'Rendering' });
    expect(bar).toHaveAttribute('aria-valuenow', '0.4');
    expect(bar).toHaveAttribute('aria-valuemax', '1');
    rerender(<ProgressBar label="Rendering" />);
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-busy', 'true');
  });

  it('Toolbar moves focus between buttons with arrow keys', () => {
    render(
      <Toolbar aria-label="Transport">
        <ToolbarGroup>
          <IconButton label="Play" icon={<svg />} tooltip={false} />
          <IconButton label="Stop" icon={<svg />} tooltip={false} />
        </ToolbarGroup>
        <ToolbarSeparator />
        <IconButton label="Record" icon={<svg />} tooltip={false} />
      </Toolbar>,
    );
    expect(screen.getByRole('toolbar', { name: 'Transport' })).toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Play' });
    play.focus();
    fireEvent.keyDown(play, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Record' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(play).toHaveFocus();
  });

  it('renders small presentational pieces', () => {
    render(
      <div>
        <Badge tone="record">Rec</Badge>
        <Spinner label="Loading project" />
        <EmptyState title="No clips" description="Drop audio here" />
        <VisuallyHidden>hidden text</VisuallyHidden>
        <ContextMenu>
          <ContextMenuTrigger>Area</ContextMenuTrigger>
        </ContextMenu>
      </div>,
    );
    expect(screen.getByRole('status', { name: 'Loading project' })).toBeInTheDocument();
    expect(screen.getByText('No clips')).toBeInTheDocument();
    expect(screen.getByText('hidden text')).toBeInTheDocument();
    expect(cn('a', false, ['b', { c: true }])).toBe('a b c');
  });
});
