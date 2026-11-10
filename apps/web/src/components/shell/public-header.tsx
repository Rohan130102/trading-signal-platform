import Link from 'next/link';
import { buttonClass } from '@/components/styles';
import { Logo } from '@/components/ui';

export function PublicHeader({ name }: { name: string }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2.5 rounded font-semibold">
        <Logo className="size-6" />
        {name}
      </Link>
      <nav aria-label="Site" className="flex items-center gap-2">
        <Link href="/about" className="rounded px-2 py-1.5 text-sm font-medium text-muted hover:text-text">
          About
        </Link>
        <Link href="/login" className={buttonClass('primary', 'sm')}>
          Sign in
        </Link>
      </nav>
    </header>
  );
}

export function PublicFooter({
  legalEntityName,
  supportContact,
  regulatoryStatement,
  results,
}: {
  legalEntityName?: string;
  supportContact?: string;
  regulatoryStatement?: string;
  results?: boolean;
}) {
  return (
    <footer className="mx-auto mt-10 w-full max-w-5xl border-t border-line px-4 py-6 text-[13px] text-muted sm:px-6">
      {regulatoryStatement && <p className="mb-3 max-w-3xl whitespace-pre-line">{regulatoryStatement}</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link href="/disclosures" className="underline underline-offset-2 hover:text-text">
          Risk disclosure and privacy
        </Link>
        <Link href={results ? '/about#performance' : '/about'} className="underline underline-offset-2 hover:text-text">
          {results ? 'About us and performance' : 'About us'}
        </Link>
        {supportContact && <span>Contact: {supportContact}</span>}
        {legalEntityName && <span>{legalEntityName}</span>}
      </div>
    </footer>
  );
}
