import { ArrowUpRight, BellRing, History, ShieldAlert, Target } from 'lucide-react';
import Link from 'next/link';
import { PublicFooter, PublicHeader } from '@/components/shell/public-header';
import { buttonClass } from '@/components/styles';
import { getPublicInfo } from '@/lib/public-info';

const FEATURES = [
  {
    icon: Target,
    title: 'Every signal, in the same clear shape',
    body: 'Instrument, direction, entry, targets and stop-loss, laid out the same way every time so you can read one in a glance.',
  },
  {
    icon: ArrowUpRight,
    title: 'Updates stay attached to their trade',
    body: 'A moved stop-loss or a booked profit shows what changed, before and after, against the trade it belongs to. It never looks like a new entry.',
  },
  {
    icon: BellRing,
    title: 'Live in the app, with phone alerts',
    body: 'The feed updates by itself. Turn on notifications to get alerts on your phone, where your device supports them.',
  },
  {
    icon: History,
    title: 'A full history you can search',
    body: 'Every signal and every later change is kept in order. Nothing is quietly edited: corrections are shown as corrections.',
  },
];

export default async function HomePage() {
  const info = await getPublicInfo();
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader name={info.serviceName} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6">
        <section className="pb-12 pt-10 sm:pt-20">
          <h1 className="max-w-3xl text-[34px] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Trade signals, and every change to them, in one clear live feed.
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
            {info.serviceDescription ||
              'Structured trade ideas with clear levels. This service communicates signals only. It does not place trades.'}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/login" className={buttonClass('primary', 'lg')}>
              Sign in
            </Link>
            {info.supportContact && (
              <p className="text-sm text-muted">New here? Contact {info.supportContact} to subscribe.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="how" className="border-t border-line py-10">
          <h2 id="how" className="sr-only">
            How it works
          </h2>
          <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="risk" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="risk" className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="size-5 text-update" aria-hidden /> Please read this first
          </h2>
          <p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted">
            {info.riskDisclosure ||
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
        regulatoryStatement={info.regulatoryStatement}
        results={info.publicResultsAvailable}
      />
    </div>
  );
}
