import type { PublicPerformanceResponse } from '@signaldesk/domain';
import { BellRing, CircleCheck, Clock, Hourglass, Lock, ScrollText, ShieldAlert, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PerformanceExplorer } from '@/components/public/performance-explorer';
import { PublicFooter, PublicHeader } from '@/components/shell/public-header';
import { buttonClass } from '@/components/styles';
import { getPublicInfo } from '@/lib/public-info';

export const metadata: Metadata = { title: 'About us and performance' };

const LIFECYCLE = [
  {
    icon: BellRing,
    title: 'Published',
    body: 'The desk sends the signal: instrument, direction, entry, targets and stop-loss, in the same clear shape every time.',
  },
  {
    icon: Hourglass,
    title: 'Awaiting entry',
    body: 'It waits for its entry level. If the entry window ends first, it is cancelled automatically and everyone is told not to enter.',
  },
  {
    icon: Clock,
    title: 'Active',
    body: 'The desk marks it active when the entry is reached. Every later change, such as a trailed stop, arrives as an update to the same trade.',
  },
  {
    icon: CircleCheck,
    title: 'Closed',
    body: 'Targets, stop-loss or a manual exit. The outcome is recorded once, and corrections are shown as corrections.',
  },
];

const PRINCIPLES = [
  {
    icon: ScrollText,
    title: 'Every outcome counts',
    body: 'Losing trades stay in the record. A trade taken off subscriber screens is still counted in every figure on this page.',
  },
  {
    icon: Lock,
    title: 'Nothing is quietly edited',
    body: 'Signals and their updates are kept in order in an append-only log. A correction is a new, visible entry.',
  },
  {
    icon: Sparkles,
    title: 'Signals, not executions',
    body: 'This service communicates signals. It does not place trades, and a published signal is not anyone’s fill.',
  },
];

async function loadResults(): Promise<PublicPerformanceResponse | null> {
  const origin = process.env.API_ORIGIN ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${origin}/api/v1/public/performance`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as PublicPerformanceResponse) : null;
  } catch {
    return null;
  }
}

/**
 * About the service, how a signal works, and, only when the API's compliance gate is open (a deployment flag
 * and a current documented approval), the full interactive record. Otherwise no figure of any kind is shown.
 */
export default async function AboutPage() {
  const [info, results] = await Promise.all([getPublicInfo(), loadResults()]);
  const about = info.aboutBody || info.serviceDescription;
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader name={info.serviceName} signupOpen={info.signupOpen} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6">
        <section className="pb-10 pt-8 sm:pt-14">
          <p className="text-sm font-medium text-muted">About us</p>
          <h1 className="mt-1 max-w-3xl text-[32px] font-semibold leading-[1.1] tracking-tight sm:text-[44px]">
            {info.serviceName}: clear signals, and an honest record of how they turned out.
          </h1>
          {about && (
            <p className="mt-4 max-w-2xl whitespace-pre-line text-[17px] leading-relaxed text-muted">{about}</p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#performance" className={buttonClass('primary', 'lg')}>
              See the record
            </a>
            <Link href="/login" className={buttonClass('secondary', 'lg')}>
              Sign in
            </Link>
          </div>
        </section>

        <section aria-labelledby="lifecycle" className="border-t border-line py-10">
          <h2 id="lifecycle" className="text-xl font-semibold tracking-tight">
            How a signal works
          </h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LIFECYCLE.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-neutral-soft text-muted">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="num text-xs text-subtle">Step {i + 1}</span>
                </div>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="principles" className="border-t border-line py-10">
          <h2 id="principles" className="text-xl font-semibold tracking-tight">
            What we hold ourselves to
          </h2>
          <ul className="mt-5 grid gap-x-10 gap-y-6 sm:grid-cols-3">
            {PRINCIPLES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="performance"
          aria-labelledby="performance-title"
          className="scroll-mt-6 border-t border-line py-10"
        >
          <h2 id="performance-title" className="text-xl font-semibold tracking-tight">
            Performance
          </h2>
          {results ? (
            <>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
                Every signal the desk published, measured the same way. Past results do not indicate future results and
                do not represent what any subscriber achieved.
              </p>
              <div className="mt-5">
                <PerformanceExplorer initial={results} />
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
              <p className="font-semibold">Results are not published yet</p>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
                Showing past trading results publicly is regulated. They appear here only after a documented compliance
                review, and then every signal is included: favourable, unfavourable, cancelled and expired.
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="risk" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="risk" className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="size-5 text-update" aria-hidden /> Risk
          </h2>
          <p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted">
            {results?.disclosures.riskDisclosure ||
              info.riskDisclosure ||
              'Trading involves substantial risk of loss. Nothing here is a promise of accuracy, profit or safety.'}
          </p>
          <Link href="/disclosures" className="mt-3 inline-block text-sm underline underline-offset-2 hover:text-text">
            Read the full disclosure
          </Link>
        </section>
      </main>
      <PublicFooter
        legalEntityName={info.legalEntityName}
        supportContact={info.supportContact}
        regulatoryStatement={results?.disclosures.regulatoryStatement || info.regulatoryStatement}
        results={info.publicResultsAvailable}
      />
    </div>
  );
}
