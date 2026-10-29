import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-5xl font-semibold tracking-tight">Studio</h1>
      <p className="max-w-xl text-lg text-text-muted">
        A local-first music workstation that runs in your browser.
      </p>
      <Link href="/studio" className="rounded-md bg-accent px-5 py-2.5 font-medium text-surface-0">
        Open Studio
      </Link>
    </main>
  );
}
