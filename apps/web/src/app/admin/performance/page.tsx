'use client';

import {
  BASIS_LABELS,
  type CalculationBasis,
  type PerformanceStats,
  type TradeAggregate,
  type TradeSummary,
  formatPrice,
  toDec,
} from '@signaldesk/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BarChart3, Info } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CumulativeChart } from '@/components/admin/cumulative-chart';
import { DirectionBadge, StatusBadge } from '@/components/trade';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Stat,
} from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime, money, signedPoints } from '@/lib/format';

interface Report {
  lifecycle: PerformanceStats;
  byBasis: { basis: CalculationBasis; stats: PerformanceStats }[];
  byInstrument: { symbol: string; byBasis: { basis: CalculationBasis; stats: PerformanceStats }[] }[];
  records: (TradeSummary & { aggregate: TradeAggregate | null; corrected: boolean })[];
  truncated: boolean;
  quoteCurrency: string | null;
  pointsComparable: boolean;
  methodology: { version: string; statements: string[] };
}

const pct = (value: string | null) =>
  value === null ? 'n/a' : `${toDec(value).times(100).toDecimalPlaces(1).toFixed()}%`;
const pts = (value: string | null) => (value === null ? 'n/a' : signedPoints(value));

function BasisCard({
  basis,
  stats,
  comparable,
  currency,
}: {
  basis: CalculationBasis;
  stats: PerformanceStats;
  comparable: boolean;
  currency: string | null;
}) {
  const measured = stats.winRateDenominator;
  return (
    <Card>
      <CardHeader
        title={BASIS_LABELS[basis]}
        description={
          basis === 'HYPOTHETICAL_OUTCOME'
            ? 'Measured from a stated entry. No real position.'
            : 'Entered by you. Not independently verified.'
        }
      />
      {measured === 0 ? (
        <p className="border-t border-line px-4 py-4 text-sm text-muted sm:px-5">
          No measured trades on this basis yet.
        </p>
      ) : (
        <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
          <Stat label="Win rate" value={pct(stats.winRate)} hint={`${stats.wins} of ${measured} measured`} />
          <Stat label="Wins / losses / flat" value={`${stats.wins} / ${stats.losses} / ${stats.breakevens}`} />
          {comparable ? (
            <>
              <Stat label="Average win" value={pts(stats.averageWinPoints)} />
              <Stat label="Average loss" value={pts(stats.averageLossPoints)} />
              <Stat label="Net move" value={signedPoints(stats.netPoints)} />
            </>
          ) : (
            <Stat
              label="Point averages"
              value="By instrument"
              hint="Choose one instrument: a point differs between them."
            />
          )}
          {stats.netPnl !== null && currency && (
            <Stat
              label="Net result"
              value={money(stats.netPnl, currency)}
              hint={`${stats.monetaryTrades} of ${measured} trades have money`}
            />
          )}
          {stats.monetaryTrades > 0 && !currency && (
            <Stat label="Net result" value="By instrument" hint="More than one quote currency in this view." />
          )}
        </dl>
      )}
    </Card>
  );
}

export default function PerformancePage() {
  const [symbol, setSymbol] = useState('');
  const [basis, setBasis] = useState<CalculationBasis | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const instruments = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: { id: string; symbol: string }[] }>('/admin/instruments'),
  });
  const report = useQuery({
    queryKey: ['admin', 'performance', symbol, basis, from, to],
    queryFn: () => api.get<Report>(`/admin/performance${queryString({ symbol, basis, from, to })}`),
    placeholderData: keepPreviousData,
  });
  const r = report.data;

  const chartBasis: CalculationBasis =
    basis === 'ADMIN_DECLARED_EXECUTION' ? 'ADMIN_DECLARED_EXECUTION' : 'HYPOTHETICAL_OUTCOME';
  const chartPoints = useMemo(
    () =>
      (r?.records ?? [])
        .filter(
          (t) => t.status === 'CLOSED' && t.aggregate?.basis === chartBasis && t.aggregate.weightedPoints !== null,
        )
        .map((t) => ({ ref: t.ref, at: t.closedAt ?? t.publishedAt, points: t.aggregate?.weightedPoints as string }))
        .sort((a, b) => a.at.localeCompare(b.at)),
    [chartBasis, r],
  );

  return (
    <>
      <PageHeader
        title="Performance"
        description="Internal analytics. Nothing on this page is visible to subscribers or the public."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Instrument">
          {(c) => (
            <Select {...c} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              <option value="">All</option>
              {instruments.data?.instruments.map((i) => (
                <option key={i.id}>{i.symbol}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Basis">
          {(c) => (
            <Select {...c} value={basis} onChange={(e) => setBasis(e.target.value as CalculationBasis | '')}>
              <option value="">Both, kept separate</option>
              <option value="HYPOTHETICAL_OUTCOME">Hypothetical</option>
              <option value="ADMIN_DECLARED_EXECUTION">Declared execution</option>
            </Select>
          )}
        </Field>
        <Field label="From">
          {(c) => <Input {...c} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label="To">
          {(c) => <Input {...c} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
      </div>
      {report.isPending && <Loading rows={3} label="Calculating" />}
      {report.isError && <ErrorState error={report.error} onRetry={() => void report.refetch()} />}
      {r && r.lifecycle.totalRecords === 0 && (
        <EmptyState icon={<BarChart3 className="size-5" aria-hidden />} title="No signals in this view yet">
          Publish and close some trades, or widen the filters.
        </EmptyState>
      )}
      {r && r.lifecycle.totalRecords > 0 && (
        <div className={`flex flex-col gap-4 transition-opacity ${report.isPlaceholderData ? 'opacity-60' : ''}`}>
          <Card>
            <CardHeader
              title="Every record in this period"
              description="Nothing is dropped: all of these add up to the total."
            />
            <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Total" value={r.lifecycle.totalRecords} />
              <Stat label="Closed" value={r.lifecycle.finalized} hint={`${r.lifecycle.unresolved} not measurable`} />
              <Stat label="Open" value={r.lifecycle.open} />
              <Stat label="Awaiting entry" value={r.lifecycle.awaitingEntry} />
              <Stat label="Cancelled" value={r.lifecycle.cancelled} />
              <Stat label="Expired, no entry" value={r.lifecycle.expiredWithoutEntry} />
            </dl>
          </Card>
          {r.byBasis.map((b) => (
            <BasisCard
              key={b.basis}
              basis={b.basis}
              stats={b.stats}
              comparable={r.pointsComparable}
              currency={r.quoteCurrency}
            />
          ))}
          <Card>
            <CardHeader
              title={symbol ? `Running total of points, ${symbol}` : 'Running total of points'}
              description={BASIS_LABELS[chartBasis]}
            />
            <div className="border-t border-line pt-3">
              {symbol ? (
                <CumulativeChart points={chartPoints} title={`Running total of points on ${symbol}`} unit="points" />
              ) : (
                <p className="flex items-start gap-2 px-4 pb-4 pt-1 text-sm text-muted sm:px-5">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> Choose one instrument. A point on one
                  instrument is not worth the same as a point on another, so adding them up would mislead.
                </p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Finished records" description="Newest first. Includes cancelled and expired signals." />
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <caption className="sr-only">Finished trades with outcomes</caption>
                <thead className="text-xs text-muted">
                  <tr>
                    {['Trade', 'Direction', 'State', 'Entry', 'Average exit', 'Move', 'Net', 'Outcome', 'Closed'].map(
                      (h) => (
                        <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {r.records.map((t) => (
                    <tr key={t.id} className="border-t border-line hover:bg-neutral-soft">
                      <td className="px-4 py-2">
                        <Link
                          href={`/admin/trades/${t.id}`}
                          className="font-semibold underline-offset-2 hover:underline"
                        >
                          {t.symbol}
                        </Link>
                        <span className="num ml-2 text-xs text-subtle">{t.ref}</span>
                        {t.corrected && (
                          <Badge tone="update" className="ml-2">
                            Corrected
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <DirectionBadge direction={t.direction} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="num px-4 py-2">
                        {formatPrice(t, t.entryLow)}
                        {t.entryType === 'RANGE' ? ` – ${formatPrice(t, t.entryHigh)}` : ''}
                      </td>
                      <td className="num px-4 py-2">
                        {t.aggregate?.averageExit ? formatPrice(t, t.aggregate.averageExit) : 'n/a'}
                      </td>
                      <td className="num px-4 py-2">
                        {t.aggregate?.weightedPoints ? signedPoints(t.aggregate.weightedPoints) : 'n/a'}
                      </td>
                      <td className="num px-4 py-2">
                        {t.aggregate?.netPnl ? money(t.aggregate.netPnl, t.quoteCurrency) : 'n/a'}
                      </td>
                      <td className="px-4 py-2">
                        {t.aggregate
                          ? { WIN: 'Win', LOSS: 'Loss', BREAKEVEN: 'Flat', UNRESOLVED: 'Unresolved' }[
                              t.aggregate.outcome
                            ]
                          : 'n/a'}
                      </td>
                      <td className="px-4 py-2 text-muted">{t.closedAt ? formatDateTime(t.closedAt) : 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold">How this is calculated ({r.methodology.version})</h2>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted">
              {r.methodology.statements.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
