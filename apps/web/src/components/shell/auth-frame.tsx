import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/ui';

export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <Link href="/" aria-label="Start page" className="mb-6 inline-block rounded">
          <Logo className="size-8" />
        </Link>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}
