import Ionicons from '@expo/vector-icons/Ionicons';
import {
  CLOSE_REASON_LABELS,
  type FeedEvent,
  formatDateTime,
  formatPrice,
  type SignalCard as Card,
  STATUS_LABELS,
  type TargetState,
} from '@signaldesk/domain';
import { useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { haptics } from '@/lib/haptics';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Badge, T } from '@/ui';
import { ChangeLine, DirectionBadge, StatusBadge, Time } from './index';

const OUTCOME = {
  WIN: { label: 'Favourable', tone: 'success' },
  LOSS: { label: 'Unfavourable', tone: 'stop' },
  BREAKEVEN: { label: 'Breakeven', tone: 'neutral' },
  UNRESOLVED: { label: 'Not measured', tone: 'neutral' },
} as const;

/** Updates that read best as before → after. Anything else shows its title; corrections are on the trade page. */
const CHANGE_TYPES = new Set<FeedEvent['type']>([
  'STOP_MOVED',
  'TARGET_HIT',
  'TARGETS_MODIFIED',
  'PARTIAL_BOOKED',
  'TRADE_CLOSED',
]);

function summary(card: Card): string {
  const fmt = (v: string) => formatPrice({ pricePrecision: card.pricePrecision }, v);
  const entry = card.entryType === 'RANGE' ? `${fmt(card.entryLow)} to ${fmt(card.entryHigh)}` : fmt(card.entryLow);
  const parts = [
    `${card.direction === 'BUY' ? 'Buy' : 'Sell'} ${card.symbol}`,
    STATUS_LABELS[card.status],
    `Entry ${entry}, stop-loss ${fmt(card.stopLoss)}`,
    ...card.targets.map((t) => `Target ${t.index} ${fmt(t.price)}${t.status === 'HIT' ? ', reached' : ''}`),
  ];
  if (card.unread) parts.unshift('New');
  const latest = card.recentUpdates[0];
  if (latest) parts.push(`Latest: ${latest.title}`);
  return parts.join('. ');
}

function Level({
  label,
  value,
  tone,
  wrap,
  testID,
}: {
  label: string;
  value: string;
  tone?: 'stop';
  wrap?: boolean;
  testID: string;
}) {
  return (
    <View style={styles.level} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <T v="caption" c="muted" numberOfLines={1}>
        {label}
      </T>
      <T v="price" c={tone ?? 'text'} numberOfLines={wrap ? 2 : 1} adjustsFontSizeToFit={!wrap} minimumFontScale={0.7}>
        {value}
      </T>
    </View>
  );
}

/**
 * Entry, stop-loss and targets in one row, for scanning a list. The trade page keeps the larger layout,
 * and both read the same current levels.
 */
export function CompactLevels({
  precision,
  entryLow,
  entryHigh,
  entryType,
  stopLoss,
  originalStopLoss,
  targets,
}: {
  precision: number;
  entryLow: string;
  entryHigh: string;
  entryType: 'SINGLE' | 'RANGE';
  stopLoss: string;
  originalStopLoss?: string;
  targets: Pick<TargetState, 'index' | 'price' | 'status'>[];
}) {
  const fmt = (v: string) => formatPrice({ pricePrecision: precision }, v);
  const range = entryType === 'RANGE';
  const moved = originalStopLoss !== undefined && originalStopLoss !== stopLoss;
  const targetsLabel = targets
    .map((t) => `Target ${t.index} ${fmt(t.price)}${t.status === 'HIT' ? ', reached' : ''}`)
    .join(', ');
  return (
    <View style={styles.levels}>
      <Level
        testID="card-entry"
        label={range ? 'Entry range' : 'Entry'}
        value={range ? `${fmt(entryLow)} – ${fmt(entryHigh)}` : fmt(entryLow)}
        wrap={range}
      />
      <Level testID="card-stop" label={moved ? 'Stop-loss (now)' : 'Stop-loss'} value={fmt(stopLoss)} tone="stop" />
      <View
        style={[styles.level, styles.targets]}
        accessible
        accessibilityLabel={targetsLabel || 'No targets'}
        testID="card-targets"
      >
        <T v="caption" c="muted" numberOfLines={1}>
          {targets.length === 1 ? 'Target' : 'Targets'}
        </T>
        <View style={styles.targetRow}>
          {targets.length === 0 && (
            <T v="price" c="muted">
              –
            </T>
          )}
          {targets.map((t) => (
            <T
              key={t.index}
              v="price"
              c={t.status === 'HIT' ? 'success' : 'text'}
              strike={t.status === 'HIT'}
              numberOfLines={1}
            >
              {fmt(t.price)}
            </T>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * One trade and everything that happened to it, kept compact so several fit on screen. The levels shown
 * are the trade's current ones; the latest update says what changed most recently; earlier updates fold
 * away. A trade with no updates yet shows nothing extra.
 */
export const SignalCard = memo(function SignalCard({
  card,
  onMenu,
  fresh = false,
}: {
  card: Card;
  onMenu: (card: Card) => void;
  /** Arrived while this list was open: outlined and labelled New for a few seconds. */
  fresh?: boolean;
}) {
  const c = useColors();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [latest, ...earlier] = card.recentUpdates;
  const finished = card.status === 'CLOSED' || card.status === 'CANCELLED' || card.status === 'EXPIRED';
  const hiddenCount = Math.max(0, card.updatesCount - card.recentUpdates.length);
  const accent = card.direction === 'BUY' ? c.buy : c.sell;
  const meta = [
    card.ref,
    formatDateTime(card.publishedAt),
    finished && card.outcome?.reason ? CLOSE_REASON_LABELS[card.outcome.reason] : null,
  ].filter(Boolean);
  return (
    <Pressable
      testID={`signal-${card.ref}`}
      accessibilityRole="button"
      accessibilityLabel={summary(card)}
      accessibilityHint="Opens the trade and its full timeline"
      accessibilityActions={[{ name: 'menu', label: 'More actions' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'menu' && onMenu(card)}
      onPress={() => router.push(`/trades/${card.id}`)}
      onLongPress={() => {
        haptics.impact();
        onMenu(card);
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: fresh ? accent : card.priority === 'PRIORITY' ? c.update : c.line,
        },
        fresh && styles.fresh,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.head}>
        <DirectionBadge direction={card.direction} />
        <T v="strong" style={styles.symbol} numberOfLines={1}>
          {card.symbol}
        </T>
        <StatusBadge status={card.status} />
        <View style={styles.spacer} />
        {fresh ? (
          <View testID="fresh-badge">
            <Badge tone={card.direction === 'BUY' ? 'buy' : 'sell'} icon="sparkles">
              New
            </Badge>
          </View>
        ) : (
          card.unread && (
            <View accessibilityLabel="New" style={[styles.dot, { backgroundColor: c.buy }]} testID="unread-dot" />
          )
        )}
        <Pressable
          testID={`signal-menu-${card.ref}`}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${card.symbol}`}
          onPress={() => onMenu(card)}
          hitSlop={4}
          style={({ pressed }) => [styles.menu, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={c.muted} />
        </Pressable>
      </View>
      <View style={styles.meta}>
        {card.priority === 'PRIORITY' && (
          <Badge tone="update" icon="warning">
            Priority
          </Badge>
        )}
        {finished && card.outcome && (
          <Badge tone={OUTCOME[card.outcome.outcome].tone}>{OUTCOME[card.outcome.outcome].label}</Badge>
        )}
        <T v="caption" c="subtle" num numberOfLines={1} style={styles.shrink}>
          {meta.join(' · ')}
        </T>
      </View>

      <CompactLevels
        precision={card.pricePrecision}
        entryLow={card.entryLow}
        entryHigh={card.entryHigh}
        entryType={card.entryType}
        targets={card.targets}
        stopLoss={card.stopLoss}
        originalStopLoss={card.originalStopLoss}
      />

      {latest && (
        <View style={[styles.latest, { backgroundColor: c.raised }]} testID="latest-update">
          <View style={styles.latestRow}>
            <View style={styles.shrink}>
              {CHANGE_TYPES.has(latest.type) ? (
                <ChangeLine event={latest} />
              ) : (
                <T v="small" style={styles.bold} numberOfLines={2}>
                  {latest.title}
                </T>
              )}
            </View>
            <Time iso={latest.createdAt} />
          </View>
          {latest.payload.comment ? (
            <T v="small" c="muted" numberOfLines={2}>
              {latest.payload.comment}
            </T>
          ) : null}
        </View>
      )}

      {earlier.length > 0 && (
        <View>
          <Pressable
            testID={`signal-expand-${card.ref}`}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? 'Hide earlier updates' : `Show ${earlier.length} earlier updates`}
            onPress={() => {
              haptics.selection();
              setExpanded((v) => !v);
            }}
            style={styles.expand}
          >
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={c.muted} />
            <T v="caption" c="muted" style={styles.bold}>
              {expanded ? 'Hide earlier updates' : `${earlier.length} earlier update${earlier.length === 1 ? '' : 's'}`}
            </T>
          </Pressable>
          {expanded &&
            earlier.map((event) => (
              <View key={event.seq} style={[styles.earlier, { borderLeftColor: c.line }]}>
                <View style={styles.latestRow}>
                  <T v="small" style={[styles.bold, styles.shrink]} numberOfLines={1}>
                    {event.title}
                  </T>
                  <Time iso={event.createdAt} />
                </View>
                <ChangeLine event={event} />
              </View>
            ))}
          {expanded && hiddenCount > 0 && (
            <T v="small" c="muted">
              Open the trade to see all {card.updatesCount} updates.
            </T>
          )}
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingTop: 10,
    paddingBottom: space.md,
    paddingLeft: space.md + 4,
    paddingRight: space.sm + 2,
    gap: space.sm,
    overflow: 'hidden',
  },
  fresh: { borderWidth: 1.5 },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  symbol: { fontWeight: '700', fontSize: 16, flexShrink: 1 },
  spacer: { flexGrow: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  menu: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -8, marginRight: -4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4 },
  shrink: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  levels: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  level: { flex: 1, minWidth: 0 },
  targets: { flex: 1.5 },
  targetRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 },
  latest: { borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: space.sm, gap: 2 },
  latestRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  expand: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    minHeight: 44,
    marginVertical: -10,
    paddingRight: space.md,
  },
  earlier: { borderLeftWidth: 2, paddingLeft: space.md, paddingVertical: space.xs, gap: 2, marginBottom: space.xs },
});
