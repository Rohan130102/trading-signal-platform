'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { formatPoints, type InstrumentSpec, instrumentSchema } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
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

type Row = InstrumentSpec & { id: string; active: boolean; sortOrder: number };
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
          <Switch label="Available for new signals" checked={active} onChange={(v) => form.setValue('active', v)} />
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
  const list = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: Row[] }>('/admin/instruments'),
  });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
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
      {list.isPending && <Loading rows={2} label="Loading instruments" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Instruments</caption>
            <thead className="text-xs text-muted">
              <tr>
                {['Symbol', 'Tick', '1 point', 'Default target', 'Default stop', 'Multiplier', 'Status', ''].map(
                  (h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {list.data.instruments.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold">{i.symbol}</span>
                    <span className="block text-xs text-muted">{i.displayName}</span>
                  </td>
                  <td className="num px-4 py-2.5">{i.tickSize}</td>
                  <td className="num px-4 py-2.5">
                    {i.pointSize} {i.quoteCurrency}
                  </td>
                  <td className="num px-4 py-2.5">{formatPoints(i.defaultTargetPoints)} pts</td>
                  <td className="num px-4 py-2.5">{formatPoints(i.defaultStopPoints)} pts</td>
                  <td className="num px-4 py-2.5">
                    {i.contractMultiplier ?? 'None'} {i.contractMultiplier ? `/ ${i.unitLabel}` : ''}
                  </td>
                  <td className="px-4 py-2.5">{i.active ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" onClick={() => setEditing(i)} aria-label={`Edit ${i.symbol}`}>
                      Edit
                    </Button>
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
