import { Dialog, DialogContent, IconButton, Kbd } from '@studio/ui';
import { Keyboard } from 'lucide-react';
import { useState } from 'react';

const GROUPS: ReadonlyArray<{ title: string; items: ReadonlyArray<readonly [string, string]> }> = [
  {
    title: 'Transport',
    items: [
      ['Space', 'Play / stop'],
      ['Home', 'Return to start'],
      ['R', 'Record (arm a track first)'],
      ['L', 'Loop on/off'],
      ['M', 'Metronome on/off'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['Mod+Z', 'Undo'],
      ['Mod+Shift+Z', 'Redo'],
      ['Delete', 'Delete selection'],
      ['Mod+D', 'Duplicate'],
      ['Mod+C / X / V', 'Copy / cut / paste clips'],
      ['Mod+E', 'Split clips at playhead'],
      ['Alt+drag', 'Duplicate clips while dragging'],
      ['Esc', 'Cancel drag / clear selection'],
    ],
  },
  {
    title: 'Piano roll (focused)',
    items: [
      ['Double-click', 'Add / delete note'],
      ['Arrows', 'Move notes by grid / semitone'],
      ['Shift+↑ / ↓', 'Move notes by octave'],
      ['Q', 'Quantize selection (or all)'],
      ['Mod+A', 'Select all notes'],
    ],
  },
  {
    title: 'View',
    items: [
      ['Mod+B', 'Toggle browser'],
      ['Mod+J', 'Toggle editor panel'],
      ['+ / −', 'Zoom arrangement'],
      ['Mod+wheel', 'Zoom at pointer'],
      ['Shift+wheel', 'Scroll horizontally'],
    ],
  },
];

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Keyboard shortcuts" icon={<Keyboard />} variant="ghost" onClick={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Keyboard shortcuts" description="Mod is ⌘ on macOS and Ctrl elsewhere." widthClassName="max-w-2xl">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[12px]">
            {GROUPS.map((group) => (
              <section key={group.title}>
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-text-muted uppercase">{group.title}</h3>
                <dl className="space-y-1">
                  {group.items.map(([keys, label]) => (
                    <div key={keys} className="flex items-center justify-between gap-3">
                      <dt className="text-text">{label}</dt>
                      <dd>
                        <Kbd>{keys}</Kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
