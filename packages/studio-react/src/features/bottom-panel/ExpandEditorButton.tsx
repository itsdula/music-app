import { Button } from '@studio/ui';
import { Maximize2, Minimize2 } from 'lucide-react';
import { toggleEditorView } from '../../lib/editor-navigation';
import { useSession, useUiState } from '../../session/context';

/** Switches between the arrangement (editor in the bottom panel) and the full-height editor. */
export function ExpandEditorButton() {
  const session = useSession();
  const expanded = useUiState((s) => s.view === 'editor');
  const label = expanded ? 'Back to arrangement' : 'Expand editor';
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => session.uiStore.setState((s) => toggleEditorView(s))}
      data-testid="editor-expand"
      data-expanded={expanded}
      title={label}
      icon={expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
    >
      {label}
    </Button>
  );
}
