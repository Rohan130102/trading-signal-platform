'use client';

import {
  formatPrice,
  type PublicOutcome,
  type TradeStatus,
  TRADE_STATUSES,
  STATUS_LABELS,
  type TradeSummary,
} from '@signaldesk/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eraser, History as HistoryIcon, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { DirectionBadge, StatusBadge } from '@/components/trade';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Switch,
} from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime, signedPoints } from '@/lib/format';

interface HistoryResult {
  trades: (TradeSummary & { outcome: PublicOutcome | null; hidden?: boolean })[];
  total: number;
  page: number;
  pageSize: number;
}

const INITIAL = { q: '', symbol: '', status: '' as TradeStatus | '', from: '', to: '' };

export default function HistoryPage() {
  const [filters, setFilters] = useState(INITIAL);
  const [page, setPage] = useState(1);
  const [cleared, setCleared] = useState(false);
  const client = useQueryClient();
  const reload = () => {
    void client.invalidateQueries({ queryKey: ['history'] });
    void client.invalidateQueries({ queryKey: ['feed'] });
    void client.invalidateQueries({ queryKey: ['active'] });
  };
  const clear = useMutation({
    mutationFn: () => api.post<{ cleared: number }>('/me/history/clear', { confirm: true }),
    onSuccess: (r) => {
      reload();
      toast.success(
        r.cleared === 0 ? 'Nothing to clear' : `${r.cleared} finished signal${r.cleared === 1 ? '' : 's'} cleared`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const restore = useMutation({
    mutationFn: () => api.post<{ restored: number }>('/me/history/restore', {}),
    onSuccess: (r) => {
      reload();
      setCleared(false);
      toast.success(`${r.restored} brought back`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const symbols = useQuery({
    queryKey: ['symbols'],
    queryFn: () => api.get<{ symbols: { symbol: string }[] }>('/instruments/symbols'),
    staleTime: 300_000,
  });
  const history = useQuery({
    queryKey: ['history', filters, page, cleared],
    queryFn: () =>
      api.get<HistoryResult>(
        `/trades/history${queryString({ ...filters, visibility: cleared ? 'HIDDEN' : 'SHOWN', page, pageSize: 20 })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const update = (patch: Partial<typeof INITIAL>) => {
    setFilters({ ...filters, ...patch });
    setPage(1);
  };
  const filtered = Object.values(filters).some(Boolean);
  return (
    <>
      <PageHeader
        title="History"
        description="Signals from your membership, whatever happened to them. Only you see what you clear."
        action={
          <Button
            loading={clear.isPending}
            onClick={() =>
              window.confirm(
                'Clear finished signals from your history and Signals? Live signals stay. Nothing is deleted, and only your own view changes.',
              ) && clear.mutate()
            }
          >
            <Eraser className="size-4" aria-hidden /> Clear history
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line px-3">
        <div className="min-w-60 flex-1">
          <Switch
            label="Show only what I cleared or hid"
            checked={cleared}
            onChange={(v) => {
              setCleared(v);
              setPage(1);
            }}
          />
        </div>
        {cleared && (
          <Button size="sm" loading={restore.isPending} onClick={() => restore.mutate()}>
            Bring them all back
          </Button>
        )}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <Field label="Search" className="col-span-2 sm:col-span-1">
          {(c) => (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <Input
                {...c}
                className="pl-9"
                type="search"
                placeholder="T-0042, XAU…"
                value={filters.q}
                onChange={(e) => update({ q: e.target.value })}
              />
            </div>
          )}
        </Field>
        <Field label="Instrument">
          {(c) => (
            <Select {...c} value={filters.symbol} onChange={(e) => update({ symbol: e.target.value })}>
              <option value="">All</option>
              {symbols.data?.symbols.map((s) => (
                <option key={s.symbol}>{s.symbol}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="State">
          {(c) => (
            <Select
              {...c}
              value={filters.status}
              onChange={(e) => update({ status: e.target.value as TradeStatus | '' })}
            >
              <option value="">All</option>
              {TRADE_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">
          {(c) => <Input {...c} type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} />}
        </Field>
        <Field label="To">
          {(c) => <Input {...c} type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} />}
        </Field>
      </div>
      {history.isPending && <Loading rows={5} label="Loading history" />}
      {history.isError && <ErrorState error={history.error} onRetry={() => void history.refetch()} />}
      {history.isSuccess && history.data.trades.length === 0 && (
        <EmptyState
          icon={<HistoryIcon className="size-5" aria-hidden />}
          title={filtered ? 'Nothing matches those filters' : 'No history yet'}
          action={filtered ? <Button onClick={() => update(INITIAL)}>Clear filters</Button> : undefined}
        >
          {filtered ? 'Try fewer filters or a wider date range.' : 'Finished signals will appear here.'}
        </EmptyState>
      )}
      {history.isSuccess && history.data.trades.length > 0 && (
        <>
          <ul className="flex flex-col gap-2">
            {history.data.trades.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/app/trades/${t.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong"
                >
                  <DirectionBadge direction={t.direction} />
                  <span className="font-semibold">{t.symbol}</span>
                  <StatusBadge status={t.status} />
                  {t.hidden && <Badge>Cleared</Badge>}
                  <span className="num text-[13px] text-muted">
                    {t.entryType === 'RANGE'
                      ? `${formatPrice(t, t.entryLow)} – ${formatPrice(t, t.entryHigh)}`
                      : formatPrice(t, t.entryLow)}
                  </span>
                  {t.outcome?.weightedPoints && (
                    <span className="num text-[13px] font-medium">{signedPoints(t.outcome.weightedPoints)}</span>
                  )}
                  <span className="ml-auto flex items-center gap-3 text-xs text-subtle">
                    <span className="num">{t.ref}</span>
                    <time dateTime={t.publishedAt}>{formatDateTime(t.publishedAt)}</time>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={history.data.page}
            pageSize={history.data.pageSize}
            total={history.data.total}
            onChange={setPage}
          />
        </>
      )}
    </>
  );
}
