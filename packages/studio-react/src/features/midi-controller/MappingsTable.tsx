import type { MidiMapping } from '@studio/domain';
import { MidiMappingSchema } from '@studio/project-storage';
import { Badge, Button, IconButton, Switch } from '@studio/ui';
import { Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useProjectState, useSession, useUiState } from '../../session/context';
import { DEVICE_PROFILES } from '../../session/midi-controller';
import { conflictingMappingIds, describeDevice, describeSource, describeTarget } from './mapping-helpers';

const PROFILE_NAMES = Object.fromEntries(DEVICE_PROFILES.map((p) => [p.id, p.displayName]));

interface MappingFile {
  readonly format: 'studio.midi-mappings';
  readonly version: 1;
  readonly mappings: readonly MidiMapping[];
}

export function MappingsTable() {
  const session = useSession();
  const project = useProjectState((s) => s.project);
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  const globalMappings = useStore(session.midi.store, (s) => s.globalMappings);
  const all = useMemo(() => [...globalMappings, ...project.midiMappings], [globalMappings, project.midiMappings]);
  const conflicts = useMemo(() => conflictingMappingIds(all), [all]);

  const setEnabled = async (m: MidiMapping, enabled: boolean) => {
    if (m.scope === 'global') await session.midi.setGlobalMappings(globalMappings.map((g) => (g.id === m.id ? { ...g, enabled } : g)));
    else session.history.execute({ type: 'mapping.update', mappingId: m.id, patch: { enabled } }, { label: enabled ? 'Enable Mapping' : 'Disable Mapping' });
  };
  const remove = async (m: MidiMapping) => {
    if (m.scope === 'global') await session.midi.setGlobalMappings(globalMappings.filter((g) => g.id !== m.id));
    else session.history.execute({ type: 'mapping.remove', mappingIds: [m.id] }, { label: 'Remove Mapping' });
  };

  const exportMappings = async () => {
    const file: MappingFile = { format: 'studio.midi-mappings', version: 1, mappings: all };
    const bytes = new TextEncoder().encode(JSON.stringify(file, null, 2));
    await session.platform.fileDialogs.saveFile(bytes, { suggestedName: 'studio-midi-mappings.json', mimeType: 'application/json' });
  };

  const importMappings = async () => {
    const [file] = await session.platform.fileDialogs.openFiles({ accept: ['.json', 'application/json'], multiple: false });
    if (!file) return;
    const parsed = JSON.parse(new TextDecoder().decode(file.bytes)) as { format?: unknown; mappings?: unknown };
    if (parsed.format !== 'studio.midi-mappings' || !Array.isArray(parsed.mappings)) throw new Error('Not a Studio MIDI mapping file.');
    // Untrusted input: validate every mapping, then give each a fresh id.
    const valid: MidiMapping[] = [];
    for (const candidate of parsed.mappings as unknown[]) {
      const result = MidiMappingSchema.safeParse(candidate);
      if (result.success) valid.push(result.data as unknown as MidiMapping);
    }
    if (valid.length === 0) throw new Error('The file contains no valid mappings.');
    const fresh = valid.map((m) => ({ ...m, id: session.edits.newMappingId() }));
    const imported = fresh.filter((m) => m.scope === 'project');
    if (imported.length > 0) {
      session.history.executeBatch(imported.map((mapping) => ({ type: 'mapping.add' as const, mapping })), { label: 'Import MIDI Mappings' });
    }
    const global = fresh.filter((m) => m.scope === 'global');
    if (global.length > 0) await session.midi.setGlobalMappings([...globalMappings, ...global]);
  };

  const report = (error: unknown) => session.midi.store.setState({ lastError: error instanceof Error ? error.message : String(error) });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mappings-table">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[12px] text-text-muted">{all.length} mappings</span>
        {conflicts.size > 0 && <Badge tone="warning">{conflicts.size} in conflict</Badge>}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={<Upload />} onClick={() => void importMappings().catch(report)}>
          Import
        </Button>
        <Button size="sm" variant="ghost" icon={<Download />} onClick={() => void exportMappings().catch(report)}>
          Export
        </Button>
        <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => void session.midi.resetGlobalMappings()}>
          Reset defaults
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-surface-1 text-[10px] tracking-wide text-text-faint uppercase">
            <tr>
              <th className="px-3 py-1.5 font-semibold">On</th>
              <th className="px-2 py-1.5 font-semibold">Control</th>
              <th className="px-2 py-1.5 font-semibold">Device</th>
              <th className="px-2 py-1.5 font-semibold">Target</th>
              <th className="px-2 py-1.5 font-semibold">Scope</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {all.map((m) => (
              <tr key={m.id} className="border-t border-line/60" data-testid="mapping-row">
                <td className="px-3 py-1">
                  <Switch label={`Enable ${m.label ?? 'mapping'}`} checked={m.enabled} onCheckedChange={(on) => void setEnabled(m, on)} />
                </td>
                <td className="px-2 py-1">
                  <div className="text-text">{m.label?.split('→')[0]?.trim() ?? describeSource(m.source)}</div>
                  <div className="text-[10px] text-text-faint">{describeSource(m.source)}</div>
                </td>
                <td className="px-2 py-1 text-text-muted">{describeDevice(m.device, PROFILE_NAMES)}</td>
                <td className="px-2 py-1">
                  {describeTarget(project, m.target, selectedTrackId)}
                  {conflicts.has(m.id) && <span className="ml-2 text-[10px] text-warning">same control as another mapping</span>}
                </td>
                <td className="px-2 py-1 text-text-muted">{m.scope === 'global' ? 'Global' : 'Project'}</td>
                <td className="px-2 py-1 text-right">
                  <IconButton label="Remove mapping" icon={<Trash2 />} size="sm" variant="ghost" onClick={() => void remove(m)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
