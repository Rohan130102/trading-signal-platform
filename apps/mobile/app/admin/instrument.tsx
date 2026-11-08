import { type InstrumentRow, instrumentSchema } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { space } from '@/theme/tokens';
import {
  Button,
  Chip,
  Field,
  FormError,
  Loading,
  ModalFrame,
  Notice,
  Screen,
  SectionTitle,
  T,
  ToggleRow,
  useToast,
} from '@/ui';

const ASSET_CLASSES = ['COMMODITY', 'FOREX', 'INDEX', 'CRYPTO', 'EQUITY', 'OTHER'] as const;

interface Form {
  symbol: string;
  displayName: string;
  assetClass: (typeof ASSET_CLASSES)[number];
  exchange: string;
  quoteCurrency: string;
  unitLabel: string;
  pricePrecision: string;
  tickSize: string;
  pointSize: string;
  defaultTargetPoints: string;
  defaultStopPoints: string;
  defaultTarget2Points: string;
  defaultTarget3Points: string;
  contractMultiplier: string;
  sortOrder: string;
  active: boolean;
}

const EMPTY: Form = {
  symbol: '',
  displayName: '',
  assetClass: 'COMMODITY',
  exchange: '',
  quoteCurrency: 'USD',
  unitLabel: '',
  pricePrecision: '2',
  tickSize: '0.01',
  pointSize: '1',
  defaultTargetPoints: '',
  defaultStopPoints: '',
  defaultTarget2Points: '',
  defaultTarget3Points: '',
  contractMultiplier: '',
  sortOrder: '100',
  active: true,
};

function fromRow(row: InstrumentRow): Form {
  return {
    symbol: row.symbol,
    displayName: row.displayName,
    assetClass: row.assetClass as Form['assetClass'],
    exchange: row.exchange ?? '',
    quoteCurrency: row.quoteCurrency,
    unitLabel: row.unitLabel,
    pricePrecision: String(row.pricePrecision),
    tickSize: row.tickSize,
    pointSize: row.pointSize,
    defaultTargetPoints: row.defaultTargetPoints,
    defaultStopPoints: row.defaultStopPoints,
    defaultTarget2Points: row.defaultTarget2Points ?? '',
    defaultTarget3Points: row.defaultTarget3Points ?? '',
    contractMultiplier: row.contractMultiplier ?? '',
    sortOrder: String(row.sortOrder),
    active: row.active,
  };
}

function Editor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const existing = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: InstrumentRow[] }>('/admin/instruments'),
    select: (data) => data.instruments.find((i) => i.id === id) ?? null,
    enabled: Boolean(id),
  });
  const row = existing.data ?? null;
  useEffect(() => {
    if (row) setForm(fromRow(row));
  }, [row]);

  const save = useMutation({
    mutationFn: (body: unknown) => (id ? api.put(`/admin/instruments/${id}`, body) : api.post('/admin/instruments', body)),
    onSuccess: () => {
      haptics.notify('success');
      toast({ tone: 'success', title: id ? 'Instrument saved' : 'Instrument added', body: 'It is available in the composer and filters straight away.' });
      void client.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      void client.invalidateQueries({ queryKey: ['symbols'] });
      router.back();
    },
    onError: () => haptics.notify('error'),
  });

  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const optional = (value: string) => (value.trim() === '' ? null : value.trim());

  const submit = () => {
    const parsed = instrumentSchema.safeParse({
      symbol: form.symbol.trim().toUpperCase(),
      displayName: form.displayName,
      assetClass: form.assetClass,
      exchange: optional(form.exchange),
      quoteCurrency: form.quoteCurrency.trim().toUpperCase(),
      unitLabel: form.unitLabel,
      pricePrecision: Number(form.pricePrecision),
      tickSize: form.tickSize.trim(),
      pointSize: form.pointSize.trim(),
      defaultTargetPoints: form.defaultTargetPoints.trim(),
      defaultStopPoints: form.defaultStopPoints.trim(),
      defaultTarget2Points: optional(form.defaultTarget2Points),
      defaultTarget3Points: optional(form.defaultTarget3Points),
      contractMultiplier: optional(form.contractMultiplier),
      sortOrder: Number(form.sortOrder || '100'),
      active: form.active,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      haptics.notify('warning');
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  if (id && existing.isPending) return <Loading rows={3} label="Loading instrument" />;
  const archived = Boolean(row?.archivedAt);
  const num = { keyboardType: 'decimal-pad' as const, autoCorrect: false, num: true };

  return (
    <Screen
      edges={['bottom']}
      keyboard
      testID="instrument-editor"
      footer={
        <Button
          testID="instrument-save"
          label={id ? 'Save changes' : 'Add instrument'}
          variant="primary"
          large
          loading={save.isPending}
          onPress={submit}
        />
      }
    >
      <Stack.Screen options={{ title: id ? (row?.symbol ?? 'Instrument') : 'New instrument' }} />
      {id && (
        <Notice tone="neutral" icon="shield-checkmark-outline">
          Changes apply to new signals only. Every published trade keeps the configuration it was published with.
        </Notice>
      )}
      {archived && (
        <Notice tone="update" icon="archive-outline">
          This instrument is archived. Restore it from the list before switching it on.
        </Notice>
      )}
      <SectionTitle>Identity</SectionTitle>
      <Field label="Symbol" testID="instrument-symbol" value={form.symbol} onChangeText={(v) => set('symbol')(v.toUpperCase())} error={errors.symbol} autoCapitalize="characters" autoCorrect={false} hint="Capitals, digits and / . _ -, such as XAU/USD. Must be unique." maxLength={24} />
      <Field label="Display name" testID="instrument-name" value={form.displayName} onChangeText={set('displayName')} error={errors.displayName} maxLength={80} />
      <View style={{ gap: space.sm }}>
        <T v="small" c="muted">
          Category
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {ASSET_CLASSES.map((value) => (
            <Chip key={value} label={value.charAt(0) + value.slice(1).toLowerCase()} on={form.assetClass === value} onPress={() => set('assetClass')(value)} />
          ))}
        </View>
      </View>
      <Field label="Exchange" value={form.exchange} onChangeText={set('exchange')} hint="Optional, for display." maxLength={40} error={errors.exchange} />
      <Field label="Quote currency" value={form.quoteCurrency} onChangeText={set('quoteCurrency')} autoCapitalize="characters" error={errors.quoteCurrency} maxLength={8} />
      <Field label="Unit" value={form.unitLabel} onChangeText={set('unitLabel')} hint="What one unit is called, such as oz, lot or share." error={errors.unitLabel} maxLength={16} />

      <SectionTitle>Prices</SectionTitle>
      <Field label="Decimal places" value={form.pricePrecision} onChangeText={set('pricePrecision')} keyboardType="number-pad" num error={errors.pricePrecision} />
      <Field label="Tick size" value={form.tickSize} onChangeText={set('tickSize')} {...num} hint="Smallest price step." error={errors.tickSize} />
      <Field label="Point size" value={form.pointSize} onChangeText={set('pointSize')} {...num} hint="Price change that counts as one point." error={errors.pointSize} />
      <Field label="Contract multiplier" value={form.contractMultiplier} onChangeText={set('contractMultiplier')} {...num} hint="Optional. Lot size, if relevant." error={errors.contractMultiplier} />

      <SectionTitle>Composer defaults</SectionTitle>
      <T v="small" c="muted">
        Suggested distances, in points, that the composer starts from. The administrator can change them on every
        signal.
      </T>
      <Field label="Target distance" value={form.defaultTargetPoints} onChangeText={set('defaultTargetPoints')} {...num} error={errors.defaultTargetPoints} />
      <Field label="Stop-loss distance" value={form.defaultStopPoints} onChangeText={set('defaultStopPoints')} {...num} error={errors.defaultStopPoints} />
      <Field label="Second target distance" value={form.defaultTarget2Points} onChangeText={set('defaultTarget2Points')} {...num} hint="Optional." error={errors.defaultTarget2Points} />
      <Field label="Third target distance" value={form.defaultTarget3Points} onChangeText={set('defaultTarget3Points')} {...num} hint="Optional." error={errors.defaultTarget3Points} />

      <SectionTitle>Availability</SectionTitle>
      <ToggleRow label="Switched on" hint="Off means it cannot be used for new signals." value={form.active && !archived} disabled={archived} onChange={set('active')} />
      <Field label="Display order" value={form.sortOrder} onChangeText={set('sortOrder')} keyboardType="number-pad" num hint="Lower numbers come first in lists." error={errors.sortOrder} />
      <FormError error={save.error} />
    </Screen>
  );
}

export default function InstrumentRoute() {
  return (
    <ModalFrame>
      <Editor />
    </ModalFrame>
  );
}
