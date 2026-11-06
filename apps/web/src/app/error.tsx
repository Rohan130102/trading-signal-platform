'use client';

import { Button } from '@/components/ui';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm text-center" role="alert">
        <h1 className="text-[22px] font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted">
          This page hit a problem on our side. Your account and signals are not affected.
        </p>
        <Button className="mt-4" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
