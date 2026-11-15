'use client';

import { type FinishedTrade, formatPrice, type PerformanceReport, toDec } from '@signaldesk/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
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
import { formatDateTime, signedPoints } from '@/lib/format';

const pct = (value: string | null) =>
  value === null ? '–' : `${toDec(value).times(100).toDecimalPlaces(1).toFixed()}%`;
const results = (n: number) => `${n} ${n === 1 ? 'result' : 'results'}`;

function ResultCell({ trade }: { trade: FinishedTrade }) {
  if (trade.points === null) return <span className="text-subtle">–</span>;
  return (
    <span
      className={clsx(
        'num font-semibold',
        trade.outcome === 'WIN' && 'text-success',
        trade.outcome === 'LOSS' && 'text-stop',
      )}
    >
      {signedPoints(trade.points)}
    </span>
  );
}

/**
 * One dashboard: how many signals, how they finished, and every finished trade. Figures come from the server's
 * single calculation; points are only ever shown for one instrument at a time.
 */
export default function PerformancePage() {
  const [symbol, setSymbol] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const instruments = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: { id: string; symbol: string }[] }>('/admin/instruments'),
  });
  const report = useQuery({
    queryKey: ['admin', 'performance', symbol, from, to],
    queryFn: () => api.get<PerformanceReport>(`/admin/performance${queryString({ symbol, from, to })}`),
    placeholderData: keepPreviousData,
  });
  const r = report.data;
  const single = r && r.instruments.length === 1 ? r.instruments[0] : undefined;

  return (
    <>
      <PageHeader title="Performance" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Instrument" className="col-span-2 sm:col-span-1">
          {(c) => (
            <Select {...c} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              <option value="">All instruments</option>
              {instruments.data?.instruments.map((i) => (
                <option key={i.id}>{i.symbol}</option>
              ))}
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
      {r && r.counts.total === 0 && (
        <EmptyState icon={<BarChart3 className="size-5" aria-hidden />} title="No signals yet" />
      )}
      {r && r.counts.total > 0 && (
        <div className={clsx('flex flex-col gap-4 transition-opacity', report.isPlaceholderData && 'opacity-60')}>
          <Card>
            <dl className="grid grid-cols-2 sm:grid-cols-5" aria-label="Signals">
              <Stat label="Total signals" value={r.counts.total} />
              <Stat label="Closed" value={r.counts.closed} />
              <Stat label="Active" value={r.counts.active} />
              <Stat label="Awaiting entry" value={r.counts.awaitingEntry} />
              <Stat label="Cancelled" value={r.counts.cancelled} />
            </dl>
            <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-5" aria-label="Results">
              <Stat
                label="Win rate"
                value={pct(r.results.winRate)}
                hint={<span title="Closed trades with a result">of {results(r.results.measured)}</span>}
              />
              <Stat label="Wins" value={r.results.wins} tone={r.results.wins > 0 ? 'success' : undefined} />
              <Stat label="Losses" value={r.results.losses} tone={r.results.losses > 0 ? 'stop' : undefined} />
              <Stat label="Breakeven" value={r.results.breakevens} />
              {single && (
                <Stat
                  label="Average result"
                  value={single.averagePoints === null ? '–' : signedPoints(single.averagePoints)}
                  hint={single.symbol}
                />
              )}
            </dl>
          </Card>

          {!single && r.instruments.length > 1 && (
            <Card>
              <CardHeader title="By instrument" />
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[520px] text-left text-[13px]">
                  <thead className="text-xs text-muted">
                    <tr>
                      {['Instrument', 'Results', 'Win rate', 'Points', 'Average'].map((h) => (
                        <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.instruments.map((i) => (
                      <tr key={i.symbol} className="border-t border-line hover:bg-neutral-soft">
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            className="rounded font-semibold underline-offset-2 hover:underline"
                            onClick={() => setSymbol(i.symbol)}
                          >
                            {i.symbol}
                          </button>
                        </td>
                        <td className="num px-4 py-2">{i.measured}</td>
                        <td className="num px-4 py-2">{pct(i.winRate)}</td>
                        <td className="num px-4 py-2">{signedPoints(i.netPoints)}</td>
                        <td className="num px-4 py-2">
                          {i.averagePoints === null ? '–' : signedPoints(i.averagePoints)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {single && r.running && r.running.length > 1 && (
            <Card>
              <CardHeader
                title="Running total"
                action={<span className="num text-sm font-semibold">{signedPoints(single.netPoints)}</span>}
              />
              <div className="border-t border-line pt-3">
                <CumulativeChart
                  points={r.running.map((p) => ({ ref: p.ref, at: p.at, points: p.points }))}
                  title={`Running total of points on ${single.symbol}`}
                  unit="points"
                />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Finished trades" />
            {r.trades.length === 0 ? (
              <p className="border-t border-line px-4 py-4 text-sm text-muted sm:px-5">No finished trades yet.</p>
            ) : (
              <>
                <ul className="border-t border-line sm:hidden" aria-label="Finished trades, newest first">
                  {r.trades.map((t) => (
                    <li key={t.id} className="border-t border-line first:border-t-0">
                      <Link
                        href={`/admin/trades/${t.id}`}
                        className="flex flex-col gap-1 px-4 py-3 hover:bg-neutral-soft"
                      >
                        <span className="flex items-center gap-2">
                          <DirectionBadge direction={t.direction} />
                          <span className="font-semibold">{t.symbol}</span>
                          <span className="num text-xs text-subtle">{t.ref}</span>
                          <span className="ml-auto">
                            <ResultCell trade={t} />
                          </span>
                        </span>
                        <span className="num flex items-center gap-2 text-xs text-muted">
                          <span className="truncate">
                            {formatPrice(t, t.entryLow)}
                            {t.exit ? ` → ${formatPrice(t, t.exit)}` : ''}
                          </span>
                          <span className="ml-auto shrink-0">{t.finishedAt ? formatDateTime(t.finishedAt) : '–'}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto border-t border-line sm:block">
                  <table className="w-full min-w-[680px] text-left text-[13px] whitespace-nowrap">
                    <caption className="sr-only">Finished trades, newest first</caption>
                    <thead className="text-xs text-muted">
                      <tr>
                        {['Trade', 'Side', 'Entry', 'Exit', 'Result', 'Status', 'Closed'].map((h) => (
                          <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.trades.map((t) => (
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
                          <td className="num px-4 py-2">
                            {formatPrice(t, t.entryLow)}
                            {t.entryType === 'RANGE' ? ` – ${formatPrice(t, t.entryHigh)}` : ''}
                          </td>
                          <td className="num px-4 py-2">{t.exit ? formatPrice(t, t.exit) : '–'}</td>
                          <td className="px-4 py-2">
                            <ResultCell trade={t} />
                          </td>
                          <td className="px-4 py-2">
                            <StatusBadge status={t.status} />
                          </td>
                          <td className="px-4 py-2 text-muted">{t.finishedAt ? formatDateTime(t.finishedAt) : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
