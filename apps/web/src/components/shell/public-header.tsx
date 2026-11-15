import { ACTIONS } from '@signaldesk/domain';
import Link from 'next/link';
import { buttonClass } from '@/components/styles';
import { Logo } from '@/components/ui';

export function PublicHeader({ name, signupAvailable = true }: { name: string; signupAvailable?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-transparent bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded font-semibold">
          <Logo className="size-7 shrink-0" />
          <span className="truncate">{name}</span>
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/about"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-text sm:inline-block"
          >
            About us
          </Link>
          <Link href="/login" className={buttonClass('ghost', 'sm')}>
            {ACTIONS.logIn}
          </Link>
          {signupAvailable && (
            <Link href="/signup" className={buttonClass('primary', 'sm')}>
              {ACTIONS.signUp}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter({
  name,
  legalEntityName,
  supportContact,
  regulatoryStatement,
  results,
}: {
  name?: string;
  legalEntityName?: string;
  supportContact?: string;
  regulatoryStatement?: string;
  results?: boolean;
}) {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[13px] text-muted sm:px-6">
        {regulatoryStatement && <p className="mb-4 max-w-3xl whitespace-pre-line">{regulatoryStatement}</p>}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/about" className="hover:text-text">
            About us
          </Link>
          {results && (
            <Link href="/about#performance" className="hover:text-text">
              Performance
            </Link>
          )}
          <Link href="/disclosures" className="hover:text-text">
            Risk disclosure and privacy
          </Link>
          <Link href="/login" className="hover:text-text">
            {ACTIONS.logIn}
          </Link>
          {supportContact && <span>Contact: {supportContact}</span>}
        </div>
        <p className="mt-4 text-subtle">
          © {new Date().getFullYear()} {legalEntityName || name || 'SignalDesk'}. Signals only: we never place trades
          for you.
        </p>
      </div>
    </footer>
  );
}
