import { EmptyState, IconButton } from '@studio/ui';
import {
  AudioLines,
  ChevronDown,
  ChevronRight,
  Drum,
  FileAudio,
  Piano,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useProjectState, useSession, useUiState } from '../../session/context';
import {
  BROWSER_DRAG_MIME,
  EFFECT_ITEMS,
  INSTRUMENT_ITEMS,
  encodeBrowserItem,
  matchesQuery,
  type BrowserItem,
} from './browser-items';
import { MidiDevicesSection } from './MidiDevicesSection';

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line/60">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold tracking-wide text-text-muted uppercase hover:text-text"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden />
        )}
        <span className="[&_svg]:size-3.5" aria-hidden>
          {icon}
        </span>
        {title}
      </button>
      {open && <ul className="pb-2">{children}</ul>}
    </section>
  );
}

function ItemRow({
  item,
  icon,
  onActivate,
  hint,
}: {
  item: BrowserItem;
  icon: ReactNode;
  onActivate: () => void;
  hint: string;
}) {
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(BROWSER_DRAG_MIME, encodeBrowserItem(item));
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onDoubleClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onActivate();
        }}
        className="group flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-text hover:bg-surface-3 focus-visible:bg-surface-3"
        title={hint}
      >
        <span className="text-text-faint [&_svg]:size-3.5" aria-hidden>
          {icon}
        </span>
        <span className="flex-1 truncate">{item.label}</span>
        <Plus className="size-3.5 text-text-faint opacity-0 group-hover:opacity-100" aria-hidden />
      </button>
    </li>
  );
}

export function BrowserPanel() {
  const session = useSession();
  const [query, setQuery] = useState('');
  const assets = useProjectState((s) => s.project.assets);
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  const assetItems = useMemo<BrowserItem[]>(
    () => Object.values(assets).map((a) => ({ kind: 'asset', assetId: a.id, label: a.name })),
    [assets],
  );

  const report = (error: unknown) =>
    session.engineStore.setState({
      lastError: {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      },
    });

  const activate = (item: BrowserItem) => {
    const { edits, engineStore } = session;
    if (item.kind === 'instrument') {
      edits.addTrack('instrument', {
        instrument: item.instrument,
        ...(item.presetId ? { presetId: item.presetId } : {}),
        name: item.instrument === 'synth' ? item.label : undefined,
      });
    } else if (item.kind === 'effect') {
      const target = selectedTrackId ?? 'master';
      edits.addEffect(target, item.effect);
      session.uiStore.setState((s) => ({
        ...s,
        panels: { ...s.panels, bottomOpen: true, bottomPanel: 'editor' },
      }));
    } else {
      const trackId =
        selectedTrackId && session.history.present.tracks[selectedTrackId]?.kind !== 'instrument'
          ? selectedTrackId
          : null;
      session.edits.placeAsset(item.assetId, trackId, engineStore.getState().cursorTick);
    }
  };

  const importFiles = async () => {
    const files = await session.platform.fileDialogs.openFiles({
      accept: ['audio/*', '.wav', '.mp3', '.flac', '.ogg', '.m4a'],
      multiple: true,
    });
    if (files.length > 0)
      await session.edits.importAudio(files, { atTick: session.engineStore.getState().cursorTick });
  };

  const instruments = INSTRUMENT_ITEMS.filter((i) => matchesQuery(i.label, query));
  const effects = EFFECT_ITEMS.filter((i) => matchesQuery(i.label, query));
  const files = assetItems.filter((i) => matchesQuery(i.label, query));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="browser-panel">
      <div className="flex items-center gap-1 border-b border-line p-2">
        <div className="flex h-7 flex-1 items-center gap-1.5 rounded-md border border-line bg-surface-0 px-2">
          <Search className="size-3.5 text-text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search browser"
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-text-faint"
          />
        </div>
        <IconButton
          label="Import audio files"
          icon={<Upload />}
          variant="ghost"
          data-testid="import-audio"
          onClick={() => void importFiles().catch(report)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Instruments" icon={<Piano />}>
          {instruments.map((item) => (
            <ItemRow
              key={item.label}
              item={item}
              icon={
                item.kind === 'instrument' && item.instrument === 'drums' ? <Drum /> : <Piano />
              }
              hint="Double-click or drag into the arrangement to add a track"
              onActivate={() => activate(item)}
            />
          ))}
        </Section>
        <Section title="Audio Effects" icon={<SlidersHorizontal />}>
          {effects.map((item) => (
            <ItemRow
              key={item.label}
              item={item}
              icon={<SlidersHorizontal />}
              hint="Double-click to add to the selected track, or drag onto a track"
              onActivate={() => activate(item)}
            />
          ))}
        </Section>
        <Section title="Project Files" icon={<FileAudio />}>
          {files.length === 0 ? (
            <li className="px-3 py-2">
              <EmptyState
                title="No audio yet"
                description="Import WAV or MP3 files, or record a take."
                icon={<AudioLines />}
              />
            </li>
          ) : (
            files.map((item) => (
              <ItemRow
                key={item.kind === 'asset' ? item.assetId : item.label}
                item={item}
                icon={<AudioLines />}
                hint="Drag onto an audio track or double-click to place at the cursor"
                onActivate={() => activate(item)}
              />
            ))
          )}
        </Section>
        <MidiDevicesSection />
      </div>
    </div>
  );
}
