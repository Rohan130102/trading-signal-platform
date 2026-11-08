import Ionicons from '@expo/vector-icons/Ionicons';
import { CLOSE_REASON_LABELS, formatDateTime, type SignalCard as Card, STATUS_LABELS } from '@signaldesk/domain';
import { useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { haptics } from '@/lib/haptics';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Badge, T } from '@/ui';
import { ChangeLine, DirectionBadge, Levels, StatusBadge, Time } from './index';

const OUTCOME = {
  WIN: { label: 'Favourable', tone: 'success' },
  LOSS: { label: 'Unfavourable', tone: 'stop' },
  BREAKEVEN: { label: 'Breakeven', tone: 'neutral' },
  UNRESOLVED: { label: 'Not measured', tone: 'neutral' },
} as const;

function summary(card: Card): string {
  const parts = [`${card.direction === 'BUY' ? 'Buy' : 'Sell'} ${card.symbol}`, STATUS_LABELS[card.status]];
  if (card.unread) parts.unshift('New');
  const latest = card.recentUpdates[0];
  if (latest) parts.push(`Latest: ${latest.title}`);
  return parts.join('. ');
}

/**
 * One trade and everything that happened to it. The levels shown are the trade's current ones; the latest
 * update says what changed most recently; earlier updates fold away so the list stays calm.
 */
export const SignalCard = memo(function SignalCard({
  card,
  onMenu,
}: {
  card: Card;
  onMenu: (card: Card) => void;
}) {
  const c = useColors();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [latest, ...earlier] = card.recentUpdates;
  const finished = card.status === 'CLOSED' || card.status === 'CANCELLED' || card.status === 'EXPIRED';
  const hiddenCount = Math.max(0, card.updatesCount - card.recentUpdates.length);
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
        { backgroundColor: c.surface, borderColor: card.priority === 'PRIORITY' ? c.update : c.line },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: card.direction === 'BUY' ? c.buy : c.sell }]} />
      <View style={styles.head}>
        <DirectionBadge direction={card.direction} large />
        <T v="heading" style={styles.symbol} numberOfLines={1}>
          {card.symbol}
        </T>
        <StatusBadge status={card.status} />
        <View style={styles.spacer} />
        {card.unread && (
          <View accessibilityLabel="New" style={[styles.dot, { backgroundColor: c.buy }]} testID="unread-dot" />
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
        <T v="caption" c="subtle" num numberOfLines={1}>
          {card.ref} · {formatDateTime(card.publishedAt)}
        </T>
      </View>

      <Levels
        precision={card.pricePrecision}
        entryLow={card.entryLow}
        entryHigh={card.entryHigh}
        entryType={card.entryType}
        targets={card.targets}
        stopLoss={card.stopLoss}
        originalStopLoss={card.originalStopLoss}
      />

      {finished && card.outcome && (
        <View style={styles.meta}>
          <Badge tone={OUTCOME[card.outcome.outcome].tone}>{OUTCOME[card.outcome.outcome].label}</Badge>
          {card.outcome.reason && (
            <T v="small" c="muted">
              {CLOSE_REASON_LABELS[card.outcome.reason]}
            </T>
          )}
        </View>
      )}

      {latest ? (
        <View style={[styles.latest, { backgroundColor: c.raised }]} testID="latest-update">
          <View style={styles.latestHead}>
            <T v="label" c="muted" style={styles.caps}>
              Latest update
            </T>
            <View style={styles.spacer} />
            <Time iso={latest.createdAt} />
          </View>
          <ChangeLine event={latest} />
          {!['STOP_MOVED', 'TARGET_HIT', 'TARGETS_MODIFIED', 'PARTIAL_BOOKED', 'TRADE_CLOSED', 'CORRECTION'].includes(
            latest.type,
          ) && <T v="strong">{latest.title}</T>}
          {latest.payload.comment ? (
            <T v="small" c="muted">
              {latest.payload.comment}
            </T>
          ) : null}
        </View>
      ) : (
        <T v="small" c="muted">
          No updates yet. Changes will appear here, attached to this signal.
        </T>
      )}

      {(earlier.length > 0 || hiddenCount > 0) && (
        <View>
          {earlier.length > 0 && (
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
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={c.muted} />
              <T v="small" c="muted" style={{ fontWeight: '600' }}>
                {expanded ? 'Hide earlier updates' : `${earlier.length} earlier update${earlier.length === 1 ? '' : 's'}`}
              </T>
            </Pressable>
          )}
          {expanded &&
            earlier.map((event) => (
              <View key={event.seq} style={[styles.earlier, { borderLeftColor: c.line }]}>
                <View style={styles.latestHead}>
                  <T v="small" style={{ fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
                    {event.title}
                  </T>
                  <View style={styles.spacer} />
                  <Time iso={event.createdAt} />
                </View>
                <ChangeLine event={event} />
              </View>
            ))}
          {expanded && hiddenCount > 0 && (
            <T v="small" c="muted" style={{ marginTop: space.xs }}>
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
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingLeft: space.lg + 2,
    paddingRight: space.md,
    gap: space.md,
    overflow: 'hidden',
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  symbol: { fontWeight: '700', flexShrink: 1 },
  spacer: { flexGrow: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  menu: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -10, marginRight: -6 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: -6 },
  latest: { borderRadius: radius.md, padding: space.md, gap: 4 },
  latestHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  caps: { textTransform: 'uppercase' },
  expand: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  earlier: { borderLeftWidth: 2, paddingLeft: space.md, paddingVertical: space.xs, gap: 2, marginBottom: space.xs },
});
