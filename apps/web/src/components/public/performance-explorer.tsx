'use client';

import { type PublicPerformanceResponse, type PublicTradeRecord, STATUS_LABELS } from '@signaldesk/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useState, useSyncExternalStore } from 'react';
import { CumulativeChart } from '@/components/admin/cumulative-chart';
import { Button, Card, CardHeader, Field, Select, Stat } from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime, percent, signedPoints } from '@/lib/format';

type Period = 'ALL' | '30' | '90' | '365';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'ALL', label: 'All time' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

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

/** In the reader's own time zone. The server renders UTC, and the browser replaces it when it takes over. */
function When({ iso }: { iso: string | null }) {
  const inBrowser = useInBrowser();
  if (!iso) return <span className="text-subtle">–</span>;
  return <time dateTime={iso}>{inBrowser ? formatDateTime(iso) : `${iso.slice(0, 16).replace('T', ' ')} UTC`}</time>;
}

function Result({ record }: { record: PublicTradeRecord }) {
  if (record.status !== 'CLOSED') return <span className="text-muted">{STATUS_LABELS[record.status]}</span>;
  if (record.weightedPoints === null) return <span className="text-muted">Closed</span>;
  return (
    <span
      className={clsx(
        'num font-semibold',
        record.outcome === 'WIN' && 'text-success',
        record.outcome === 'LOSS' && 'text-stop',
      )}
    >
      {signedPoints(record.weightedPoints)}
    </span>
  );
}

const PAGE = 25;

/**
 * The public record of completed signals: the same trades and the same calculation as the desk's own dashboard,
 * without prices or position sizes. Points appear for one instrument at a time.
 */
export function PerformanceExplorer({ initial }: { initial: PublicPerformanceResponse }) {
  const [period, setPeriod] = useState<Period>('ALL');
  const [symbol, setSymbol] = useState('');
  const [shown, setShown] = useState(PAGE);
  const from = period === 'ALL' ? undefined : daysAgo(Number(period));
  const query = useQuery({
    queryKey: ['public', 'performance', from, symbol],
    queryFn: () => api.get<PublicPerformanceResponse>(`/public/performance${queryString({ from, symbol })}`),
    initialData: from || symbol ? undefined : initial,
    placeholderData: keepPreviousData,
  });
  const data = query.data ?? initial;
  const single = data.instruments.length === 1 ? data.instruments[0] : undefined;
  const symbols = initial.instruments.map((i) => i.symbol);

  return (
    <div className="flex flex-col gap-4">
      <div
        className={clsx('grid grid-cols-2 gap-3 sm:max-w-md', query.isFetching && 'opacity-80')}
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
              {symbols.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Card>
        <dl className="grid grid-cols-2 sm:grid-cols-4" aria-label="Signals">
          <Stat label="Signals" value={data.counts.total} />
          <Stat label="Closed" value={data.counts.closed} />
          <Stat label="Cancelled" value={data.counts.cancelled} />
          <Stat
            label="Win rate"
            value={data.results.winRate ? percent(data.results.winRate) : '–'}
            hint={`of ${data.results.measured} ${data.results.measured === 1 ? 'result' : 'results'}`}
          />
        </dl>
        <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4" aria-label="Results">
          <Stat label="Wins" value={data.results.wins} />
          <Stat label="Losses" value={data.results.losses} />
          <Stat label="Breakeven" value={data.results.breakevens} />
          {single && (
            <Stat
              label="Average result"
              value={single.averagePoints === null ? '–' : signedPoints(single.averagePoints)}
              hint={single.symbol}
            />
          )}
        </dl>
      </Card>

      {single && data.running && data.running.length > 1 && (
        <Card>
          <CardHeader
            title="Running total"
            action={<span className="num text-sm font-semibold">{signedPoints(single.netPoints)}</span>}
          />
          <CumulativeChart
            points={data.running.map((p) => ({ ref: p.ref, at: p.at, points: p.points }))}
            title={`Running total of points on ${single.symbol}`}
            unit="points"
          />
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="Completed signals" />
        <div className="overflow-x-auto border-t border-line" role="region" aria-label="Completed signals" tabIndex={0}>
          <table className="w-full min-w-[560px] whitespace-nowrap text-left text-sm">
            <caption className="sr-only">Completed signals, newest first</caption>
            <thead className="text-xs text-muted">
              <tr>
                {['Signal', 'Instrument', 'Side', 'Result', 'Closed'].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.records.slice(0, shown).map((r) => (
                <tr key={`${r.ref}-${r.publishedAt}`} className="border-t border-line">
                  <td className="num px-4 py-2">
                    {r.ref}
                    {r.corrected && (
                      <span className="ml-2 rounded bg-bg px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted">
                        Corrected
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-medium">{r.symbol}</td>
                  <td className="px-4 py-2">{r.direction === 'SELL' ? 'Sell' : 'Buy'}</td>
                  <td className="px-4 py-2">
                    <Result record={r} />
                  </td>
                  <td className="num px-4 py-2 text-muted">
                    <When iso={r.finishedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.records.length > shown && (
          <div className="border-t border-line p-3 text-center">
            <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>
              Show more
            </Button>
          </div>
        )}
      </Card>

      <p className="text-[13px] text-muted">
        {data.dataResetAt ? (
          <>
            The record starts on <When iso={data.dataResetAt} />.{' '}
          </>
        ) : null}
        Reviewed for {data.disclosures.approval.jurisdiction}, reference {data.disclosures.approval.documentReference}.
      </p>
    </div>
  );
}
