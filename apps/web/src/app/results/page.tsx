import type { PerformanceStats } from '@signaldesk/domain';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicFooter, PublicHeader } from '@/components/shell/public-header';
import { getPublicInfo } from '@/lib/public-info';

export const metadata: Metadata = { title: 'Historical record' };

interface PublicResults {
  measurementPeriod: { from: string | null; to: string | null };
  lifecycle: PerformanceStats;
  hypothetical: PerformanceStats;
  declared: PerformanceStats;
  records: {
    ref: string;
    symbol: string;
    direction: string;
    status: string;
    publishedAt: string | null;
    closedAt: string | null;
    basis: string | null;
    weightedPoints: string | null;
    outcome: string | null;
  }[];
  methodology: { version: string; statements: string[] };
  disclosures: {
    riskDisclosure: string;
    regulatoryStatement: string;
    approval: { jurisdiction: string; scope: string; documentReference: string; expiresAt: string };
  };
}

const date = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : 'n/a');

function BasisStats({ title, stats, note }: { title: string; stats: PerformanceStats; note: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-[13px] text-muted">{note}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Measured trades', stats.winRateDenominator],
          ['Favourable', stats.wins],
          ['Unfavourable', stats.losses],
          ['Breakeven', stats.breakevens],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="num text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

async function loadResults(): Promise<PublicResults | null> {
  const origin = process.env.API_ORIGIN ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${origin}/api/v1/public/performance`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as PublicResults) : null;
  } catch {
    return null;
  }
}

/**
 * Only reachable when the API's compliance gate is open: a deployment flag and a current, documented
 * approval are both required, and the API returns 404 otherwise. All outcomes in the period are shown,
 * and hypothetical and declared records are never combined.
 */
export default async function ResultsPage() {
  const results = await loadResults();
  if (!results) notFound();
  const info = await getPublicInfo();
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader name={info.serviceName} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 sm:px-6">
        <h1 className="text-[28px] font-semibold tracking-tight">Historical record</h1>
        <p className="mt-1 text-sm text-muted">
          Every signal from {date(results.measurementPeriod.from)} to {date(results.measurementPeriod.to)}. Past results
          do not indicate future results and do not represent what any subscriber achieved.
        </p>
        <div className="mt-5 flex flex-col gap-4">
          <BasisStats
            title="Hypothetical outcomes"
            stats={results.hypothetical}
            note="What the signal would have recorded from its stated entry. No real position."
          />
          <BasisStats
            title="Administrator-declared executions"
            stats={results.declared}
            note="Entered by the administrator. Not independently verified."
          />
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">Not counted above, and still part of the record</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Cancelled', results.lifecycle.cancelled],
                ['Expired, no entry', results.lifecycle.expiredWithoutEntry],
                ['Still open', results.lifecycle.open + results.lifecycle.awaitingEntry],
                ['Closed, not measurable', results.lifecycle.unresolved],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="num text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section
            className="overflow-x-auto rounded-xl border border-line bg-surface"
            aria-label="All finished signals"
            tabIndex={0}
          >
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">All finished signals</caption>
              <thead className="text-xs text-muted">
                <tr>
                  {['Signal', 'Instrument', 'Direction', 'Published', 'State', 'Basis', 'Points'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.records.map((r) => (
                  <tr key={r.ref} className="border-t border-line">
                    <td className="num px-4 py-2">{r.ref}</td>
                    <td className="px-4 py-2">{r.symbol}</td>
                    <td className="px-4 py-2">{r.direction}</td>
                    <td className="num px-4 py-2">{date(r.publishedAt)}</td>
                    <td className="px-4 py-2">{r.status}</td>
                    <td className="px-4 py-2">{r.basis ?? 'None'}</td>
                    <td className="num px-4 py-2">{r.weightedPoints ?? 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">How this is calculated ({results.methodology.version})</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              {results.methodology.statements.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-muted">
              Reviewed for {results.disclosures.approval.jurisdiction}. Reference:{' '}
              {results.disclosures.approval.documentReference}.
            </p>
          </section>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{results.disclosures.riskDisclosure}</p>
        </div>
      </main>
      <PublicFooter
        legalEntityName={info.legalEntityName}
        supportContact={info.supportContact}
        regulatoryStatement={results.disclosures.regulatoryStatement}
        results
      />
    </div>
  );
}
