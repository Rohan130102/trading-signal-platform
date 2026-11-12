'use client';

import {
  type CalculationBasis,
  type Direction,
  type PublicPerformanceResponse,
  type PublicTradeRecord,
  STATUS_LABELS,
  type TradeOutcome,
} from '@signaldesk/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { CumulativeChart } from '@/components/admin/cumulative-chart';
import { Button, Card, CardHeader, Field, Segmented, Select, Stat } from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime, percent, signedPoints } from '@/lib/format';
import { type MonthOutcomes, OutcomeChart } from './outcome-chart';

type Period = 'ALL' | '30' | '90' | '365';
type Basis = Extract<CalculationBasis, 'HYPOTHETICAL_OUTCOME' | 'ADMIN_DECLARED_EXECUTION'>;

const PERIODS: { value: Period; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

const OUTCOME_LABELS: Record<TradeOutcome, string> = {
  WIN: 'Favourable',
  LOSS: 'Unfavourable',
  BREAKEVEN: 'Breakeven',
  UNRESOLVED: 'Not measurable',
};

function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const noSubscription = () => () => undefined;
/** False while the server renders and during hydration, true in the browser afterwards. */
const useInBrowser = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

/**
 * In the reader's own time zone and locale. The server cannot know either, so it renders the instant in UTC and
 * the browser replaces it as soon as it takes over.
 */
function When({ iso }: { iso: string | null }) {
  const inBrowser = useInBrowser();
  if (!iso) return <span className="text-subtle">n/a</span>;
  return <time dateTime={iso}>{inBrowser ? formatDateTime(iso) : `${iso.slice(0, 16).replace('T', ' ')} UTC`}</time>;
}

function OutcomeTag({ record }: { record: PublicTradeRecord }) {
  if (record.status !== 'CLOSED') return <span className="text-muted">{STATUS_LABELS[record.status]}</span>;
  const outcome = record.outcome ?? 'UNRESOLVED';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={{
          background:
            outcome === 'WIN' ? 'var(--chart-win)' : outcome === 'LOSS' ? 'var(--chart-loss)' : 'var(--subtle)',
        }}
      />
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

const PAGE = 25;

/**
 * The public record, interactive. Filters narrow the period, instrument and direction, and every figure is
 * recomputed by the server for that selection. The outcome filter only narrows the table: figures are never
 * computed from a subset chosen by result. Hypothetical outcomes and declared executions are never combined.
 */
export function PerformanceExplorer({ initial }: { initial: PublicPerformanceResponse }) {
  const [period, setPeriod] = useState<Period>('ALL');
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<Direction | ''>('');
  const [outcome, setOutcome] = useState<TradeOutcome | ''>('');
  const [shown, setShown] = useState(PAGE);
  const from = period === 'ALL' ? undefined : daysAgo(Number(period));
  const filtered = Boolean(from || symbol || direction);
  const query = useQuery({
    queryKey: ['public', 'performance', from, symbol, direction],
    queryFn: () => api.get<PublicPerformanceResponse>(`/public/performance${queryString({ from, symbol, direction })}`),
    initialData: filtered ? undefined : initial,
    placeholderData: keepPreviousData,
  });
  const data = query.data ?? initial;
  const hasDeclared = data.declared.winRateDenominator > 0;
  const [basisChoice, setBasis] = useState<Basis>('HYPOTHETICAL_OUTCOME');
  const basis: Basis = hasDeclared ? basisChoice : 'HYPOTHETICAL_OUTCOME';
  const stats = basis === 'HYPOTHETICAL_OUTCOME' ? data.hypothetical : data.declared;

  const measured = useMemo(
    () =>
      data.records
        .filter((r) => r.status === 'CLOSED' && r.basis === basis)
        .sort((a, b) => (a.exitedAt ?? a.closedAt ?? '').localeCompare(b.exitedAt ?? b.closedAt ?? '')),
    [basis, data.records],
  );
  const months = useMemo<MonthOutcomes[]>(() => {
    const byMonth = new Map<string, MonthOutcomes>();
    for (const r of measured) {
      const at = r.exitedAt ?? r.closedAt;
      if (!at || !r.outcome || r.outcome === 'UNRESOLVED') continue;
      const month = at.slice(0, 7);
      const row = byMonth.get(month) ?? { month, wins: 0, losses: 0, breakevens: 0 };
      if (r.outcome === 'WIN') row.wins += 1;
      else if (r.outcome === 'LOSS') row.losses += 1;
      else row.breakevens += 1;
      byMonth.set(month, row);
    }
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [measured]);
  const singleInstrument = symbol !== '' || data.symbols.length === 1;
  const curve = useMemo(
    () =>
      measured
        .filter((r) => r.weightedPoints !== null)
        .map((r) => ({ ref: r.ref ?? '', at: r.exitedAt ?? r.closedAt ?? '', points: r.weightedPoints as string })),
    [measured],
  );
  const rows = data.records.filter((r) => !outcome || (r.status === 'CLOSED' && r.outcome === outcome));

  return (
    <div className="flex flex-col gap-4">
      <div
        className={clsx('grid grid-cols-2 gap-3 sm:grid-cols-4', query.isFetching && 'opacity-80')}
        role="group"
        aria-label="Filters"
      >
        <Field label="Period">
          {(c) => (
            <Select {...c} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Instrument">
          {(c) => (
            <Select {...c} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              <option value="">All instruments</option>
              {[...new Set([...initial.symbols, ...data.symbols])].sort().map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Direction">
          {(c) => (
            <Select {...c} value={direction} onChange={(e) => setDirection(e.target.value as Direction | '')}>
              <option value="">Buy and sell</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </Select>
          )}
        </Field>
        <Field label="Outcome (table only)">
          {(c) => (
            <Select {...c} value={outcome} onChange={(e) => setOutcome(e.target.value as TradeOutcome | '')}>
              <option value="">Every outcome</option>
              <option value="WIN">Favourable</option>
              <option value="LOSS">Unfavourable</option>
              <option value="BREAKEVEN">Breakeven</option>
            </Select>
          )}
        </Field>
      </div>

      {hasDeclared && (
        <Segmented<Basis>
          label="What the figures rest on"
          value={basis}
          onChange={setBasis}
          options={[
            { value: 'HYPOTHETICAL_OUTCOME', label: 'Hypothetical outcomes' },
            { value: 'ADMIN_DECLARED_EXECUTION', label: 'Declared executions' },
          ]}
        />
      )}

      <Card>
        <CardHeader
          title={basis === 'HYPOTHETICAL_OUTCOME' ? 'Hypothetical outcomes' : 'Declared executions'}
          description={
            basis === 'HYPOTHETICAL_OUTCOME'
              ? 'What following each signal at its stated levels would have produced. No real trade is implied.'
              : 'Entries and exits the desk declared. Not independently verified.'
          }
        />
        <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
          <Stat
            label="Win rate"
            value={stats.winRate ? percent(stats.winRate) : 'n/a'}
            hint={`${stats.wins} of ${stats.winRateDenominator} measured trades`}
          />
          <Stat label="Favourable" value={stats.wins} />
          <Stat label="Unfavourable" value={stats.losses} />
          <Stat label="Breakeven" value={stats.breakevens} />
        </dl>
        <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
          <Stat label="Expired, no entry" value={data.lifecycle.expiredWithoutEntry} hint="Cancelled automatically" />
          <Stat label="Cancelled" value={data.lifecycle.cancelled} />
          <Stat label="Still open" value={data.lifecycle.open + data.lifecycle.awaitingEntry} />
          <Stat label="Closed, not measurable" value={data.lifecycle.unresolved} />
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Outcomes by month" description="Finished trades, by the month of their last exit." />
          <OutcomeChart months={months} />
        </Card>
        <Card>
          <CardHeader
            title="Running total of points"
            description={
              singleInstrument
                ? `Weighted points of each finished trade, added up in the order they closed${symbol ? ` (${symbol})` : ''}.`
                : 'Points of different instruments are not comparable. Pick one instrument to draw this.'
            }
          />
          {singleInstrument ? (
            <CumulativeChart points={curve} title="Running total of points" unit="points" />
          ) : (
            <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">
              {data.symbols.map((s) => (
                <Button key={s} size="sm" onClick={() => setSymbol(s)}>
                  {s}
                </Button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Every finished signal"
          description={`${rows.length} record${rows.length === 1 ? '' : 's'}. Times are shown in your device’s time zone.`}
        />
        <div
          className="overflow-x-auto border-t border-line"
          role="region"
          aria-label="Every finished signal"
          tabIndex={0}
        >
          <table className="w-full min-w-[860px] whitespace-nowrap text-left text-sm">
            <caption className="sr-only">Every finished signal</caption>
            <thead className="text-xs text-muted">
              <tr>
                {[
                  'Signal',
                  'Instrument',
                  'Direction',
                  'Outcome',
                  'Published',
                  'Activated',
                  'Exit',
                  'Points',
                  'Basis',
                ].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r) => (
                <tr key={`${r.ref}-${r.publishedAt}`} className="border-t border-line">
                  <td className="num px-4 py-2">
                    {r.ref}
                    {r.corrected && (
                      <span
                        className="ml-2 rounded bg-bg px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted"
                        title="Corrected after publication. See Corrected under Definitions."
                      >
                        Corrected
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-medium">{r.symbol}</td>
                  <td className="px-4 py-2">{r.direction === 'SELL' ? 'Sell' : 'Buy'}</td>
                  <td className="px-4 py-2">
                    <OutcomeTag record={r} />
                  </td>
                  <td className="num px-4 py-2 text-muted">
                    <When iso={r.publishedAt} />
                  </td>
                  <td className="num px-4 py-2 text-muted">
                    <When iso={r.activatedAt} />
                  </td>
                  <td className="num px-4 py-2 text-muted">
                    <When iso={r.exitedAt ?? (r.status === 'CLOSED' ? r.closedAt : null)} />
                  </td>
                  <td className="num px-4 py-2">{r.weightedPoints ? signedPoints(r.weightedPoints) : 'n/a'}</td>
                  <td className="px-4 py-2 text-muted">
                    {r.basis === 'ADMIN_DECLARED_EXECUTION'
                      ? 'Declared'
                      : r.basis === 'HYPOTHETICAL_OUTCOME'
                        ? 'Hypothetical'
                        : 'None'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown && (
          <div className="border-t border-line p-3 text-center">
            <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, rows.length - shown)} more
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="font-semibold">What these figures mean</h3>
        <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {data.methodology.definitions.map((d) => (
            <div key={d.term}>
              <dt className="text-sm font-medium">{d.term}</dt>
              <dd className="text-[13px] leading-relaxed text-muted">{d.meaning}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-5 font-semibold">How it is calculated ({data.methodology.version})</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-muted">
          {data.methodology.statements.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-muted">
          {data.removedFromScreens > 0
            ? `${data.removedFromScreens} finished signal${data.removedFromScreens === 1 ? ' was' : 's were'} taken off subscriber screens and ${data.removedFromScreens === 1 ? 'is' : 'are'} still counted above. `
            : ''}
          {data.dataResetAt ? (
            <>
              Test data from before <When iso={data.dataResetAt} /> was cleared; the record starts after it.{' '}
            </>
          ) : null}
          Reviewed for {data.disclosures.approval.jurisdiction}. Reference:{' '}
          {data.disclosures.approval.documentReference}.
        </p>
      </Card>
    </div>
  );
}
