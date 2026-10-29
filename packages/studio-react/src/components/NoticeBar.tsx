import { IconButton } from '@studio/ui';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useEngineState, useSession } from '../session/context';

/** One-line notices: engine errors, recovery messages. Dismissible; never blocks work. */
export function NoticeBar() {
  const session = useSession();
  const engineError = useEngineState((s) => s.lastError);
  const [projectNotice, setProjectNotice] = useState<string | null>(() => session.projects.takeNotice());
  const message = engineError?.message ?? projectNotice;
  if (!message) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1 text-[12px] text-text">
      <span className="flex-1">{message}</span>
      <IconButton
        label="Dismiss notice"
        icon={<X />}
        size="sm"
        variant="ghost"
        onClick={() => {
          if (engineError) session.engineStore.setState({ lastError: null });
          else setProjectNotice(null);
        }}
      />
    </div>
  );
}
