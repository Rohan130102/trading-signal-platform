'use client';

import {
  STATUS_LABELS,
  TRADE_STATUSES,
  type TradeAggregate,
  type TradeStatus,
  type TradeSummary,
  formatPrice,
} from '@signaldesk/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Activity, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DirectionBadge, StatusBadge } from '@/components/trade';
import {
  Button,
  buttonClass,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Select,
} from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime, signedPoints } from '@/lib/format';

interface Result {
  trades: (TradeSummary & { aggregate: TradeAggregate | null })[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AdminTradesPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TradeStatus | 'LIVE' | ''>('LIVE');
  const [symbol, setSymbol] = useState('');
  const [page, setPage] = useState(1);
  const instruments = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: { id: string; symbol: string }[] }>('/admin/instruments'),
  });
  const trades = useQuery({
    queryKey: ['admin', 'trades', q, status, symbol, page],
    queryFn: () =>
      api.get<Result>(
        `/admin/trades${queryString({ q, symbol, page, pageSize: 25, live: status === 'LIVE' ? 'true' : undefined, status: status === 'LIVE' ? undefined : status })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const filtered = Boolean(q || symbol || status !== '');
  return (
    <>
      <PageHeader
        title="Trades"
        action={
          <Link href="/admin/compose" className={buttonClass('primary')}>
            <Plus className="size-4" aria-hidden /> New signal
          </Link>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Search" className="col-span-2 sm:col-span-1">
          {(c) => (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <Input
                {...c}
                type="search"
                className="pl-9"
                placeholder="T-0042, instrument, commentary"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          )}
        </Field>
        <Field label="State">
          {(c) => (
            <Select
              {...c}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as TradeStatus | 'LIVE' | '');
                setPage(1);
              }}
            >
              <option value="LIVE">Live now</option>
              <option value="">All</option>
              {TRADE_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Instrument">
          {(c) => (
            <Select
              {...c}
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {instruments.data?.instruments.map((i) => (
                <option key={i.id}>{i.symbol}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {trades.isPending && <Loading rows={5} label="Loading trades" />}
      {trades.isError && <ErrorState error={trades.error} onRetry={() => void trades.refetch()} />}
      {trades.isSuccess && trades.data.trades.length === 0 && (
        <EmptyState
          icon={<Activity className="size-5" aria-hidden />}
          title={status === 'LIVE' && !q && !symbol ? 'Nothing is live right now' : 'No trades match'}
          action={
            filtered ? (
              <Button
                onClick={() => {
                  setQ('');
                  setSymbol('');
                  setStatus('');
                }}
              >
                Show all trades
              </Button>
            ) : undefined
          }
        />
      )}
      {trades.isSuccess && trades.data.trades.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Trades</caption>
              <thead className="text-xs text-muted">
                <tr>
                  {['Trade', 'Direction', 'State', 'Entry', 'Stop-loss', 'Result', 'Published'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.data.trades.map((t) => (
                  <tr key={t.id} className="border-t border-line transition-colors hover:bg-neutral-soft">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/trades/${t.id}`}
                        className="rounded font-semibold underline-offset-2 hover:underline"
                      >
                        {t.symbol}
                      </Link>
                      <span className="num ml-2 text-xs text-subtle">{t.ref}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <DirectionBadge direction={t.direction} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="num px-4 py-2.5">
                      {t.entryType === 'RANGE'
                        ? `${formatPrice(t, t.entryLow)} – ${formatPrice(t, t.entryHigh)}`
                        : formatPrice(t, t.entryLow)}
                    </td>
                    <td className="num px-4 py-2.5 text-stop">{formatPrice(t, t.stopLoss)}</td>
                    <td className="num px-4 py-2.5">
                      {t.aggregate?.weightedPoints ? (
                        signedPoints(t.aggregate.weightedPoints)
                      ) : (
                        <span className="text-muted">n/a</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted">{formatDateTime(t.publishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination
            page={trades.data.page}
            pageSize={trades.data.pageSize}
            total={trades.data.total}
            onChange={setPage}
          />
        </>
      )}
    </>
  );
}
