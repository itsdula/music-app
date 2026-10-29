import { PPQ } from '@studio/domain';
import { useEffect, type RefObject } from 'react';
import { useSession } from '../../session/context';
import { openClipInEditor, selectClips } from '../../state/ui-store';
import { isTextEntryTarget, matchShortcut, type ShortcutAction } from './shortcuts';

const isApple = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/**
 * Global (Studio-scoped) shortcuts. Editors that need their own handling of keys like
 * Delete or arrows (the piano roll, vocal editor) stop propagation for those events.
 */
export function useKeyboardShortcuts(rootRef: RefObject<HTMLElement | null>): void {
  const session = useSession();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const apple = isApple();
    const run = (action: ShortcutAction): boolean => {
      const { transport, edits, history, uiStore, engineStore } = session;
      const ui = uiStore.getState();
      const clipIds = [...ui.selection.clipIds];
      switch (action) {
        case 'togglePlay':
          void transport.togglePlay();
          return true;
        case 'rewind':
          void transport.rewind();
          return true;
        case 'record':
          void transport.record();
          return true;
        case 'toggleLoop':
          transport.toggleLoop();
          return true;
        case 'toggleMetronome':
          transport.toggleMetronome();
          return true;
        case 'undo':
          history.undo();
          return true;
        case 'redo':
          history.redo();
          return true;
        case 'delete':
          if (clipIds.length === 0) return false;
          edits.deleteClips(clipIds);
          return true;
        case 'duplicate':
          if (clipIds.length === 0) return false;
          edits.duplicateClips(clipIds);
          return true;
        case 'copy':
          if (clipIds.length === 0) return false;
          edits.copyClips(clipIds);
          return true;
        case 'cut':
          if (clipIds.length === 0) return false;
          edits.cutClips(clipIds);
          return true;
        case 'paste': {
          const position = session.engine.getTransportPosition();
          const at =
            position.state === 'stopped'
              ? engineStore.getState().cursorTick
              : Math.round(position.ticks);
          return edits.paste(at, ui.selection.trackId).length > 0;
        }
        case 'split': {
          const position = session.engine.getTransportPosition();
          const at =
            position.state === 'stopped'
              ? engineStore.getState().cursorTick
              : Math.round(position.ticks);
          edits.splitClipsAt(clipIds, at);
          return true;
        }
        case 'selectAll':
          uiStore.setState((s) =>
            selectClips(s, Object.keys(history.present.clips) as typeof clipIds),
          );
          return true;
        case 'toggleBrowser':
          uiStore.setState((s) => ({
            ...s,
            panels: { ...s.panels, browserOpen: !s.panels.browserOpen },
          }));
          return true;
        case 'toggleEditor':
          uiStore.setState((s) => ({
            ...s,
            panels: { ...s.panels, bottomOpen: !s.panels.bottomOpen },
          }));
          return true;
        case 'zoomIn':
        case 'zoomOut': {
          const factor = action === 'zoomIn' ? 1.25 : 0.8;
          uiStore.setState((s) => ({
            ...s,
            arrangement: {
              ...s.arrangement,
              pxPerTick: Math.min(2, Math.max(2 / PPQ, s.arrangement.pxPerTick * factor)),
            },
          }));
          return true;
        }
        case 'escape':
          uiStore.setState((s) => openClipInEditor(selectClips(s, []), s.selection.editorClipId));
          return true;
        case 'quantize':
          return false; // handled by the piano roll when focused
      }
    };
    // Listen on the document, i.e. after React's delegated handlers, so an editor can claim
    // a key (Delete, arrows…) with stopPropagation()/preventDefault() in its React onKeyDown.
    // Only keys pressed inside this Studio instance count; the embedding page keeps its own.
    const doc = root.ownerDocument;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !root.contains(event.target)) return;
      if (event.defaultPrevented || isTextEntryTarget(event.target)) return;
      const action = matchShortcut(event, apple);
      if (!action) return;
      if (event.repeat && action !== 'zoomIn' && action !== 'zoomOut') return;
      if (run(action)) event.preventDefault();
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [rootRef, session]);
}
