'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { formatPoints, type InstrumentRow, instrumentSchema } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  FormError,
  Input,
  Loading,
  PageHeader,
  Select,
  Switch,
} from '@/components/ui';
import { api } from '@/lib/api';

type Row = InstrumentRow;
type Values = z.input<typeof instrumentSchema>;

const BLANK: Values = {
  symbol: '',
  displayName: '',
  assetClass: 'COMMODITY',
  quoteCurrency: 'USD',
  pricePrecision: 2,
  tickSize: '0.01',
  pointSize: '1',
  defaultTargetPoints: '150',
  defaultStopPoints: '180',
  defaultTarget2Points: null,
  defaultTarget3Points: null,
  contractMultiplier: '1',
  unitLabel: '',
  active: true,
  sortOrder: 100,
  exchange: null,
};

const nullable = (v: string) => (v === '' || v === null ? null : v);

function Editor({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const client = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(instrumentSchema),
    defaultValues: row
      ? {
          symbol: row.symbol,
          displayName: row.displayName,
          assetClass: row.assetClass as Values['assetClass'],
          quoteCurrency: row.quoteCurrency,
          pricePrecision: row.pricePrecision,
          tickSize: row.tickSize,
          pointSize: row.pointSize,
          defaultTargetPoints: row.defaultTargetPoints,
          defaultStopPoints: row.defaultStopPoints,
          defaultTarget2Points: row.defaultTarget2Points,
          defaultTarget3Points: row.defaultTarget3Points,
          contractMultiplier: row.contractMultiplier,
          unitLabel: row.unitLabel,
          active: row.active,
          sortOrder: row.sortOrder,
          exchange: row.exchange,
        }
      : BLANK,
  });
  const save = useMutation({
    mutationFn: (values: Values) =>
      row ? api.put(`/admin/instruments/${row.id}`, values) : api.post('/admin/instruments', values),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      toast.success('Instrument saved');
      onClose();
    },
  });
  const errors = form.formState.errors;
  const active = form.watch('active') ?? true;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={row ? `Edit ${row.symbol}` : 'New instrument'}
      description="Changes apply to new signals. Trades already published keep the settings they were published with."
    >
      <form
        onSubmit={(e) => void form.handleSubmit((v) => save.mutate(v))(e)}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Symbol" required error={errors.symbol?.message}>
            {(c) => <Input {...c} className="num" autoFocus placeholder="XAU/USD" {...form.register('symbol')} />}
          </Field>
          <Field label="Display name" required error={errors.displayName?.message}>
            {(c) => <Input {...c} {...form.register('displayName')} />}
          </Field>
          <Field label="Asset class" error={errors.assetClass?.message}>
            {(c) => (
              <Select {...c} {...form.register('assetClass')}>
                {['COMMODITY', 'CRYPTO', 'FOREX', 'INDEX', 'EQUITY', 'OTHER'].map((v) => (
                  <option key={v} value={v}>
                    {v.charAt(0) + v.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Quote currency" required error={errors.quoteCurrency?.message}>
            {(c) => <Input {...c} {...form.register('quoteCurrency')} />}
          </Field>
          <Field label="Exchange" error={errors.exchange?.message} hint="Optional, for display.">
            {(c) => <Input {...c} {...form.register('exchange', { setValueAs: nullable })} />}
          </Field>
        </div>
        <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-3">
          <legend className="px-1 text-[13px] font-medium text-muted">Price arithmetic</legend>
          <Field label="Price decimals" error={errors.pricePrecision?.message}>
            {(c) => (
              <Input
                {...c}
                className="num"
                type="number"
                min={0}
                max={8}
                {...form.register('pricePrecision', { valueAsNumber: true })}
              />
            )}
          </Field>
          <Field label="Tick size" error={errors.tickSize?.message} hint="Smallest allowed price step.">
            {(c) => <Input {...c} className="num" inputMode="decimal" {...form.register('tickSize')} />}
          </Field>
          <Field label="Value of 1 point" error={errors.pointSize?.message} hint="In quote currency.">
            {(c) => <Input {...c} className="num" inputMode="decimal" {...form.register('pointSize')} />}
          </Field>
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3 rounded-lg border border-line p-3 sm:grid-cols-4">
          <legend className="px-1 text-[13px] font-medium text-muted">Default offsets, in points</legend>
          <Field label="Target 1" error={errors.defaultTargetPoints?.message}>
            {(c) => <Input {...c} className="num" inputMode="decimal" {...form.register('defaultTargetPoints')} />}
          </Field>
          <Field label="Target 2" error={errors.defaultTarget2Points?.message}>
            {(c) => (
              <Input
                {...c}
                className="num"
                inputMode="decimal"
                {...form.register('defaultTarget2Points', { setValueAs: nullable })}
              />
            )}
          </Field>
          <Field label="Target 3" error={errors.defaultTarget3Points?.message}>
            {(c) => (
              <Input
                {...c}
                className="num"
                inputMode="decimal"
                {...form.register('defaultTarget3Points', { setValueAs: nullable })}
              />
            )}
          </Field>
          <Field label="Stop-loss" error={errors.defaultStopPoints?.message}>
            {(c) => <Input {...c} className="num" inputMode="decimal" {...form.register('defaultStopPoints')} />}
          </Field>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Contract multiplier"
            error={errors.contractMultiplier?.message}
            hint="Empty means no monetary results."
          >
            {(c) => (
              <Input
                {...c}
                className="num"
                inputMode="decimal"
                {...form.register('contractMultiplier', { setValueAs: nullable })}
              />
            )}
          </Field>
          <Field label="Unit label" required error={errors.unitLabel?.message} hint="oz, BTC, lot…">
            {(c) => <Input {...c} {...form.register('unitLabel')} />}
          </Field>
          <Field label="Sort order" error={errors.sortOrder?.message}>
            {(c) => (
              <Input {...c} className="num" type="number" {...form.register('sortOrder', { valueAsNumber: true })} />
            )}
          </Field>
        </div>
        <div className="rounded-lg border border-line px-3">
          <Switch
            label="Available for new signals"
            description={row?.archivedAt ? 'Archived. Restore it from the list before switching it on.' : undefined}
            checked={active && !row?.archivedAt}
            onChange={(v) => form.setValue('active', v)}
          />
        </div>
        <FormError error={save.error} />
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}

export default function InstrumentsPage() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: Row[] }>('/admin/instruments'),
  });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'current' | 'archived' | 'all'>('current');
  const archive = useMutation({
    mutationFn: ({ row, restore }: { row: Row; restore: boolean }) =>
      api.post(`/admin/instruments/${row.id}/${restore ? 'restore' : 'archive'}`),
    onSuccess: (_d, { row, restore }) => {
      void client.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      toast.success(
        restore ? `${row.symbol} restored. It stays off until you switch it on.` : `${row.symbol} archived`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data?.instruments ?? []).filter(
      (i) =>
        (show === 'all' || (show === 'archived' ? i.archivedAt : !i.archivedAt)) &&
        (!q || [i.symbol, i.displayName, i.exchange ?? ''].some((v) => v.toLowerCase().includes(q))),
    );
  }, [list.data, query, show]);
  const confirmArchive = (row: Row) => {
    if (
      window.confirm(
        `Archive ${row.symbol}? It can no longer be used for new signals and leaves the filters once it has no trades. Its ${row.tradeCount} published trades keep their history. You can restore it.`,
      )
    )
      archive.mutate({ row, restore: false });
  };
  return (
    <>
      <PageHeader
        title="Instruments"
        description="A point is not the same size everywhere. Set what one point means on each instrument."
        action={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> New instrument
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search instruments"
          placeholder="Search symbol, name or exchange"
          className="max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          aria-label="Show"
          value={show}
          onChange={(e) => setShow(e.target.value as typeof show)}
          className="max-w-[12rem]"
        >
          <option value="current">Current</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </Select>
      </div>
      {list.isPending && <Loading rows={2} label="Loading instruments" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <caption className="sr-only">Instruments</caption>
            <thead className="text-xs text-muted">
              <tr>
                {['Symbol', 'Tick', '1 point', 'Default target', 'Default stop', 'Trades', 'Status', ''].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-muted">
                    Nothing matches.
                  </td>
                </tr>
              )}
              {rows.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold">{i.symbol}</span>
                    <span className="block text-xs text-muted">
                      {[i.displayName, i.exchange].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="num px-4 py-2.5">{i.tickSize}</td>
                  <td className="num px-4 py-2.5">
                    {i.pointSize} {i.quoteCurrency}
                  </td>
                  <td className="num px-4 py-2.5">{formatPoints(i.defaultTargetPoints)} pts</td>
                  <td className="num px-4 py-2.5">{formatPoints(i.defaultStopPoints)} pts</td>
                  <td className="num px-4 py-2.5">{i.tradeCount}</td>
                  <td className="px-4 py-2.5">
                    {i.archivedAt ? (
                      <Badge>Archived</Badge>
                    ) : i.active ? (
                      <Badge tone="success">On</Badge>
                    ) : (
                      <Badge>Off</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <Button size="sm" onClick={() => setEditing(i)} aria-label={`Edit ${i.symbol}`}>
                      Edit
                    </Button>{' '}
                    {i.archivedAt ? (
                      <Button
                        size="sm"
                        onClick={() => archive.mutate({ row: i, restore: true })}
                        aria-label={`Restore ${i.symbol}`}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => confirmArchive(i)}
                        aria-label={`Archive ${i.symbol}`}
                      >
                        Archive
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <Editor row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
