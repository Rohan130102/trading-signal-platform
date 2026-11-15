import { ACTIONS, whatsappDigits } from '@signaldesk/domain';
import {
  ArrowRight,
  BellRing,
  History,
  Layers,
  MailCheck,
  MessageCircle,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { SignalPreview } from '@/components/marketing/signal-preview';
import { PublicFooter, PublicHeader } from '@/components/shell/public-header';
import { buttonClass } from '@/components/styles';
import { getPublicInfo } from '@/lib/public-info';

const FEATURES = [
  {
    icon: Layers,
    tone: 'bg-buy-soft text-buy',
    title: 'Clear levels, every time',
    body: 'Instrument, direction, entry, targets and stop-loss, always in the same shape, so a signal reads at a glance.',
  },
  {
    icon: Sparkles,
    tone: 'bg-update-soft text-update',
    title: 'Updates on the same trade',
    body: 'A moved stop-loss or a reached target shows what changed against the trade it belongs to. It never looks like a new entry.',
  },
  {
    icon: BellRing,
    tone: 'bg-success-soft text-success',
    title: 'Live, with phone alerts',
    body: 'Signals arrive the moment they are published, in the app and on the website, with notifications where your phone allows.',
  },
  {
    icon: History,
    tone: 'bg-sell-soft text-sell',
    title: 'A history you can trust',
    body: 'Every signal and every change is kept in order. Corrections are shown as corrections, never quietly edited.',
  },
];

const STEPS = [
  {
    icon: MailCheck,
    title: 'Create your account',
    body: 'Your name, email and mobile number. We confirm your email with a code.',
  },
  { icon: MessageCircle, title: 'Talk to us', body: 'Choose a subscription with our team on WhatsApp or by email.' },
  {
    icon: Smartphone,
    title: 'Receive signals',
    body: 'Follow them live on the website or the app, with alerts on your phone.',
  },
];

export default async function HomePage() {
  const info = await getPublicInfo();
  const whatsapp = whatsappDigits(info.supportWhatsapp);
  const primary = info.signupOpen
    ? { href: '/signup', label: ACTIONS.createAccount }
    : whatsapp
      ? { href: `https://wa.me/${whatsapp}`, label: 'Message us on WhatsApp' }
      : { href: '/login', label: ACTIONS.logIn };
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader name={info.serviceName} signupOpen={info.signupOpen} />
      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(45% 55% at 15% 0%, var(--buy-soft), transparent 70%), radial-gradient(40% 50% at 95% 30%, var(--success-soft), transparent 70%)',
            }}
          />
          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-20">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-muted">
                <ShieldCheck className="size-3.5 text-success" aria-hidden />
                Signals only. We never place trades for you.
              </p>
              <h1 className="mt-5 text-[36px] font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[56px]">
                Trade signals, and every change to them, in one clear place.
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
                {info.serviceDescription ||
                  'Structured trade ideas with clear entries, targets and stop-losses, updated live as the trade develops.'}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href={primary.href} className={buttonClass('primary', 'lg', 'w-full sm:w-auto')}>
                  {primary.label}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link href="/login" className={buttonClass('secondary', 'lg', 'w-full sm:w-auto')}>
                  {ACTIONS.logIn}
                </Link>
              </div>
              {!info.signupOpen && (
                <p className="mt-3 text-sm text-muted">New sign-ups are paused. Contact us to join.</p>
              )}
            </div>
            <SignalPreview className="mx-auto w-full max-w-md lg:max-w-none" />
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="features" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Built to be read in a glance
          </h2>
          <p className="mt-2 max-w-2xl text-muted">Everything you need to follow a signal, and nothing you don’t.</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, tone, title, body }) => (
              <li key={title} className="rounded-2xl border border-line bg-surface p-5">
                <span className={`grid size-10 place-items-center rounded-xl ${tone}`}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="how" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong text-sm font-semibold">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Icon className="size-4 text-muted" aria-hidden />
                      {title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {info.aboutBody && (
          <section aria-labelledby="about" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="about" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              About us
            </h2>
            <p className="mt-4 line-clamp-4 max-w-3xl whitespace-pre-line leading-relaxed text-muted">
              {info.aboutBody}
            </p>
            <Link href="/about" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline">
              Read more about us <ArrowRight className="size-4" aria-hidden />
            </Link>
          </section>
        )}

        <section aria-labelledby="risk" className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <h2 id="risk" className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="size-5 text-update" aria-hidden /> Please read this first
            </h2>
            <p className="mt-2 line-clamp-4 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted">
              {info.riskDisclosure ||
                'Trading involves substantial risk of loss. Nothing here is a promise of accuracy, profit or safety.'}
            </p>
            <Link
              href="/disclosures"
              className="mt-3 inline-block text-sm underline underline-offset-2 hover:text-text"
            >
              Read the full disclosure
            </Link>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pt-14 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-5 rounded-2xl border border-line bg-raised p-6 sm:flex-row sm:items-center sm:p-8">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Ready when you are</h2>
              <p className="mt-1 text-muted">
                {info.signupOpen
                  ? 'Create your account in a minute. You choose a subscription with our team afterwards.'
                  : 'Message our team to join.'}
              </p>
            </div>
            <Link href={primary.href} className={buttonClass('primary', 'lg', 'w-full sm:w-auto')}>
              {primary.label}
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter
        name={info.serviceName}
        legalEntityName={info.legalEntityName}
        supportContact={info.supportContact}
        regulatoryStatement={info.regulatoryStatement}
        results={info.publicResultsAvailable}
      />
    </div>
  );
}
