import { Spinner } from '@studio/ui';

export function StartupScreen({ status, message }: { status: 'booting' | 'error'; message?: string | undefined }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted" role="status" aria-live="polite">
      {status === 'booting' ? (
        <>
          <Spinner />
          <span className="text-[12px]">Starting Studio…</span>
        </>
      ) : (
        <div className="max-w-md rounded-lg border border-record/40 bg-record/10 p-4 text-[12px] text-text">
          <p className="mb-1 font-semibold text-record">Studio could not start</p>
          <p className="text-text-muted">{message}</p>
        </div>
      )}
    </div>
  );
}
