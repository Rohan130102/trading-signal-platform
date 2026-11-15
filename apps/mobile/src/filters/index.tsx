import Ionicons from '@expo/vector-icons/Ionicons';
import {
  countActiveFilters,
  type Direction,
  EMPTY_SIGNAL_FILTER,
  normaliseFilter,
  type SignalFilter,
  STATUS_GROUP_LABELS,
  STATUS_GROUPS,
  type StatusGroup,
} from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { prefs } from '@/lib/storage';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Button, Chip, Field, Segmented, Sheet, T } from '@/ui';

export interface InstrumentOption {
  symbol: string;
  displayName: string;
  assetClass: string;
  exchange: string | null;
  archived: boolean;
}

export function useInstruments() {
  return useQuery({
    queryKey: ['symbols'],
    queryFn: () => api.get<{ symbols: InstrumentOption[] }>('/instruments/symbols'),
    staleTime: 300_000,
    select: (data) => data.symbols,
  });
}

/** A filter that survives restarts. Instruments that no longer exist are dropped quietly. */
export function useSavedFilter(key: string, known?: readonly string[]) {
  const [filter, setFilter] = useState<SignalFilter>(EMPTY_SIGNAL_FILTER);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void prefs.get<unknown>(key).then((saved) => {
      if (!active) return;
      setFilter(normaliseFilter(saved));
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    if (!known || !loaded) return;
    setFilter((current) => {
      const cleaned = normaliseFilter(current, known);
      return cleaned.symbols.length === current.symbols.length ? current : cleaned;
    });
  }, [known, loaded]);
  const update = useCallback(
    (next: SignalFilter) => {
      setFilter(next);
      void prefs.set(key, next);
    },
    [key],
  );
  return { filter, setFilter: update, loaded };
}

/** A searchable list with a clear selected state. Used on its own and inside the filter sheet. */
function InstrumentList({
  instruments,
  selected,
  onToggle,
  onAll,
}: {
  instruments: InstrumentOption[];
  selected: string[];
  onToggle: (symbol: string) => void;
  onAll: () => void;
}) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? instruments.filter(
            (i) =>
              i.symbol.toLowerCase().includes(q) ||
              i.displayName.toLowerCase().includes(q) ||
              (i.exchange ?? '').toLowerCase().includes(q),
          )
        : instruments,
    [instruments, q],
  );
  const row = (key: string, label: string, sub: string | null, on: boolean, onPress: () => void, testID: string) => (
    <Pressable
      key={key}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [styles.row, { borderBottomColor: c.line, opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.flex}>
        <T v="strong" numberOfLines={1}>
          {label}
        </T>
        {sub ? (
          <T v="small" c="muted" numberOfLines={1}>
            {sub}
          </T>
        ) : null}
      </View>
      <View
        style={[
          styles.check,
          { borderColor: on ? c.primary : c.lineStrong, backgroundColor: on ? c.primary : 'transparent' },
        ]}
      >
        {on && <Ionicons name="checkmark" size={16} color={c.primaryText} />}
      </View>
    </Pressable>
  );
  return (
    <View style={{ gap: space.sm }}>
      <Field
        label="Search instruments"
        testID="instrument-search"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <View>
        {!q && row('all', 'All instruments', null, selected.length === 0, onAll, 'instrument-all')}
        {shown.map((i) =>
          row(
            i.symbol,
            i.symbol,
            [i.displayName, i.exchange, i.archived ? 'Archived' : null].filter(Boolean).join(' · '),
            selected.includes(i.symbol),
            () => onToggle(i.symbol),
            `instrument-${i.symbol}`,
          ),
        )}
        {shown.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="search" size={20} color={c.subtle} />
            <T c="muted" center>
              No instrument matches “{query.trim()}”.
            </T>
          </View>
        )}
      </View>
    </View>
  );
}

function toggle(list: string[], symbol: string): string[] {
  return list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol];
}

export function InstrumentPicker({
  visible,
  instruments,
  selected,
  onDone,
  onClose,
}: {
  visible: boolean;
  instruments: InstrumentOption[];
  selected: string[];
  onDone: (symbols: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(selected);
  useEffect(() => {
    if (visible) setDraft(selected);
  }, [selected, visible]);
  if (!visible) return null;
  return (
    <Sheet
      title="Instruments"
      subtitle={draft.length === 0 ? 'Showing all instruments' : `${draft.length} selected`}
      onClose={onClose}
      testID="instrument-picker"
      footer={
        <View style={styles.footer}>
          <Button label="Clear" variant="ghost" onPress={() => setDraft([])} disabled={draft.length === 0} />
          <Button
            label={draft.length === 0 ? 'Show all' : `Show ${draft.length}`}
            variant="primary"
            testID="instrument-apply"
            style={styles.flex}
            onPress={() => onDone(draft)}
          />
        </View>
      }
    >
      <InstrumentList
        instruments={instruments}
        selected={draft}
        onToggle={(symbol) => setDraft((d) => toggle(d, symbol))}
        onAll={() => setDraft([])}
      />
    </Sheet>
  );
}

const DIRECTIONS: readonly { value: 'ANY' | Direction; label: string; testID: string }[] = [
  { value: 'ANY', label: 'Any', testID: 'direction-any' },
  { value: 'BUY', label: 'Buy', testID: 'direction-buy' },
  { value: 'SELL', label: 'Sell', testID: 'direction-sell' },
];

export function FilterSheet({
  visible,
  value,
  instruments,
  onApply,
  onClose,
  extra,
  groups = STATUS_GROUPS,
}: {
  visible: boolean;
  value: SignalFilter;
  instruments: InstrumentOption[];
  onApply: (filter: SignalFilter) => void;
  onClose: () => void;
  extra?: ReactNode;
  /** The statuses this list offers. Signals shows live trades only; finished ones are in History. */
  groups?: readonly StatusGroup[];
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (visible) setDraft(value);
  }, [value, visible]);
  if (!visible) return null;
  return (
    <Sheet
      title="Filters"
      subtitle={countActiveFilters(draft) === 0 ? 'Showing everything' : `${countActiveFilters(draft)} on`}
      onClose={onClose}
      testID="filter-sheet"
      footer={
        <View style={styles.footer}>
          <Button
            label="Reset"
            variant="ghost"
            testID="filter-reset"
            onPress={() => setDraft(EMPTY_SIGNAL_FILTER)}
            disabled={countActiveFilters(draft) === 0}
          />
          <Button
            label="Apply"
            variant="primary"
            testID="filter-apply"
            style={styles.flex}
            onPress={() => onApply(draft)}
          />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <T v="label" c="muted" style={styles.caps}>
          Status
        </T>
        <View style={styles.wrap}>
          {groups.map((group) => (
            <Chip
              key={group}
              testID={`status-${group}`}
              label={STATUS_GROUP_LABELS[group]}
              on={draft.status === group}
              onPress={() => setDraft({ ...draft, status: group as StatusGroup })}
            />
          ))}
        </View>
      </View>
      <View style={{ gap: space.sm }}>
        <T v="label" c="muted" style={styles.caps}>
          Direction
        </T>
        <Segmented
          label="Direction"
          options={DIRECTIONS}
          value={draft.direction ?? 'ANY'}
          onChange={(v) => setDraft({ ...draft, direction: v === 'ANY' ? null : v })}
        />
      </View>
      {extra}
      <View style={{ gap: space.sm }}>
        <T v="label" c="muted" style={styles.caps}>
          Instruments
        </T>
        <InstrumentList
          instruments={instruments}
          selected={draft.symbols}
          onToggle={(symbol) => setDraft({ ...draft, symbols: toggle(draft.symbols, symbol) })}
          onAll={() => setDraft({ ...draft, symbols: [] })}
        />
      </View>
    </Sheet>
  );
}

/** One instrument button and one Filters button, with what is on shown as chips that remove themselves. */
export function FilterBar({
  value,
  onChange,
  instruments,
  extraCount = 0,
  extraChips,
  sheetExtra,
  groups,
}: {
  value: SignalFilter;
  onChange: (filter: SignalFilter) => void;
  instruments: InstrumentOption[];
  extraCount?: number;
  extraChips?: ReactNode;
  sheetExtra?: ReactNode;
  groups?: readonly StatusGroup[];
}) {
  const c = useColors();
  const [picker, setPicker] = useState(false);
  const [sheet, setSheet] = useState(false);
  const active = countActiveFilters(value) + extraCount;
  const instrumentLabel =
    value.symbols.length === 0
      ? 'All instruments'
      : value.symbols.length === 1
        ? (value.symbols[0] as string)
        : `${value.symbols.length} instruments`;
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.bar}>
        <Pressable
          testID="instrument-button"
          accessibilityRole="button"
          accessibilityLabel={`Instruments: ${instrumentLabel}`}
          accessibilityHint="Choose which instruments to show"
          onPress={() => setPicker(true)}
          style={({ pressed }) => [
            styles.pill,
            styles.flex,
            { backgroundColor: c.raised, borderColor: c.line, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="layers-outline" size={16} color={c.muted} />
          <T v="strong" numberOfLines={1} style={styles.flex}>
            {instrumentLabel}
          </T>
          <Ionicons name="chevron-down" size={16} color={c.muted} />
        </Pressable>
        <Pressable
          testID="filter-button"
          accessibilityRole="button"
          accessibilityLabel={active > 0 ? `Filters, ${active} on` : 'Filters'}
          onPress={() => setSheet(true)}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: c.raised, borderColor: active ? c.primary : c.line, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="options-outline" size={16} color={c.text} />
          <T v="strong">Filters</T>
          {active > 0 && (
            <View style={[styles.count, { backgroundColor: c.primary }]}>
              <T v="caption" style={{ color: c.primaryText, fontWeight: '700' }} num>
                {active}
              </T>
            </View>
          )}
        </Pressable>
      </View>
      {(countActiveFilters(value) > 0 || extraChips) && (
        <View style={styles.wrap}>
          {value.status !== 'ALL' && (
            <Chip
              icon="close"
              label={STATUS_GROUP_LABELS[value.status]}
              on
              onPress={() => onChange({ ...value, status: 'ALL' })}
            />
          )}
          {value.direction && (
            <Chip
              icon="close"
              label={value.direction === 'BUY' ? 'Buy' : 'Sell'}
              on
              onPress={() => onChange({ ...value, direction: null })}
            />
          )}
          {value.symbols.length > 1 &&
            value.symbols.map((symbol) => (
              <Chip
                key={symbol}
                icon="close"
                label={symbol}
                on
                onPress={() => onChange({ ...value, symbols: value.symbols.filter((s) => s !== symbol) })}
              />
            ))}
          {extraChips}
        </View>
      )}
      <InstrumentPicker
        visible={picker}
        instruments={instruments}
        selected={value.symbols}
        onClose={() => setPicker(false)}
        onDone={(symbols) => {
          setPicker(false);
          onChange({ ...value, symbols });
        }}
      />
      <FilterSheet
        visible={sheet}
        value={value}
        instruments={instruments}
        extra={sheetExtra}
        groups={groups}
        onClose={() => setSheet(false)}
        onApply={(next) => {
          setSheet(false);
          onChange(next);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bar: { flexDirection: 'row', gap: space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  caps: { textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  footer: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
});
