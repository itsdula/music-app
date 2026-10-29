import { SegmentedControl } from '@studio/ui';
import { useSession, useUiState } from '../../session/context';
import { navigate, type StudioView } from '../../state/ui-store';

const LABELS: Record<StudioView, string> = {
  projects: 'Projects',
  arrange: 'Arrange',
  editor: 'Editor',
};

/** Switches between the top-level Studio pages. */
export function ViewSwitcher() {
  const session = useSession();
  const view = useUiState((s) => s.view);
  return (
    <SegmentedControl
      label="Page"
      size="sm"
      value={view}
      onChange={(v) => session.uiStore.setState((s) => navigate(s, v as StudioView))}
      options={(Object.keys(LABELS) as StudioView[]).map((v) => ({ value: v, label: LABELS[v] }))}
      data-testid="view-switcher"
    />
  );
}
