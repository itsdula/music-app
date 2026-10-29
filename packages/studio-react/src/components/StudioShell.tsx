import { ResizeHandle } from '@studio/ui';
import { useEffect, useRef } from 'react';
import { ArrangementView } from '../features/arrangement/ArrangementView';
import { AssistantPanel } from '../features/assistant/AssistantPanel';
import { ProjectsPage } from '../features/projects-page/ProjectsPage';
import { TutorialLayer } from '../features/tutorial/TutorialLayer';
import { BottomPanel } from '../features/bottom-panel/BottomPanel';
import { BrowserPanel } from '../features/browser/BrowserPanel';
import { TransportBar } from '../features/transport/TransportBar';
import { useKeyboardShortcuts } from '../features/shortcuts/use-keyboard-shortcuts';
import { useSession, useUiState } from '../session/context';
import { LearnBanner } from './LearnBanner';
import { NoticeBar } from './NoticeBar';

export function StudioShell() {
  const session = useSession();
  const panels = useUiState((s) => s.panels);
  const view = useUiState((s) => s.view);
  const assistantOpen = useUiState((s) => s.assistantOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  useKeyboardShortcuts(rootRef);

  // Browsers require a user gesture before audio can start: resume on the first interaction.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const unlock = () => {
      void session.transport.ensureAudio();
    };
    root.addEventListener('pointerdown', unlock, { capture: true, once: true });
    root.addEventListener('keydown', unlock, { capture: true, once: true });
    return () => {
      root.removeEventListener('pointerdown', unlock, { capture: true });
      root.removeEventListener('keydown', unlock, { capture: true });
    };
  }, [session]);

  const setPanels = (patch: Partial<typeof panels>) =>
    session.uiStore.setState((s) => ({ ...s, panels: { ...s.panels, ...patch } }));

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col" tabIndex={-1}>
      <TransportBar />
      <NoticeBar />
      <LearnBanner />
      <div className="flex min-h-0 flex-1">
        {view === 'projects' ? (
          <ProjectsPage />
        ) : (
          <>
            {panels.browserOpen && (
              <>
                <aside
                  id="studio-browser"
                  className="flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface-1"
                  style={{ width: panels.browserWidth }}
                >
                  <BrowserPanel />
                </aside>
                <ResizeHandle
                  label="Resize browser"
                  controls="studio-browser"
                  orientation="vertical"
                  size={panels.browserWidth}
                  min={180}
                  max={420}
                  defaultSize={232}
                  onSizeChange={(browserWidth) => setPanels({ browserWidth })}
                />
              </>
            )}
            <main className="flex min-w-0 flex-1 flex-col" data-view={view}>
              {view === 'editor' ? (
                <section
                  id="studio-bottom-panel"
                  className="flex min-h-0 flex-1 flex-col bg-surface-1"
                  data-testid="editor-view"
                >
                  <BottomPanel />
                </section>
              ) : (
                <>
                  <ArrangementView />
                  {panels.bottomOpen && (
                    <>
                      <ResizeHandle
                        label="Resize editor"
                        controls="studio-bottom-panel"
                        orientation="horizontal"
                        direction={-1}
                        size={panels.bottomHeight}
                        min={160}
                        max={900}
                        defaultSize={360}
                        onSizeChange={(bottomHeight) => setPanels({ bottomHeight })}
                      />
                      <section
                        id="studio-bottom-panel"
                        className="flex shrink-0 flex-col border-t border-line bg-surface-1"
                        style={{ height: panels.bottomHeight }}
                      >
                        <BottomPanel />
                      </section>
                    </>
                  )}
                </>
              )}
            </main>
          </>
        )}
        {assistantOpen && <AssistantPanel />}
      </div>
      <TutorialLayer />
    </div>
  );
}
