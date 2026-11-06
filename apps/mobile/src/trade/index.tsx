import { Ionicons } from '@expo/vector-icons';
import {
  BASIS_LABELS,
  basisShort,
  categoryLabel,
  CLOSE_REASON_LABELS,
  type Direction,
  type FeedEvent,
  formatClock,
  formatDateTime,
  formatPrice,
  formatRelative,
  percent,
  type PublicOutcome,
  signedPoints,
  STATUS_LABELS,
  type TargetState,
  type TemplateTone,
  type TradeStatus,
  type TradeSummary,
} from '@signaldesk/domain';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useColors } from '@/theme';
import type { Palette } from '@/theme/tokens';
import { radius, space } from '@/theme/tokens';
import { Badge, T, type TextVariant, type Tone } from '@/ui';

export function DirectionBadge({ direction, large }: { direction: Direction; large?: boolean }) {
  const c = useColors();
  const buy = direction === 'BUY';
  return (
    <View
      accessibilityLabel={buy ? 'Buy' : 'Sell'}
      style={[
        styles.direction,
        { backgroundColor: buy ? c.buySoft : c.sellSoft },
        large && { paddingHorizontal: 10, paddingVertical: 5 },
      ]}
    >
      <Ionicons name={buy ? 'arrow-up' : 'arrow-down'} size={large ? 16 : 12} color={buy ? c.buy : c.sell} />
      <T v={large ? 'strong' : 'caption'} c={buy ? 'buy' : 'sell'} style={{ fontWeight: '700' }}>
        {direction}
      </T>
    </View>
  );
}

const STATUS_TONE: Record<TradeStatus, Tone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'update',
  ACTIVE: 'buy',
  PARTIALLY_CLOSED: 'buy',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

export function StatusBadge({ status }: { status: TradeStatus }) {
  const live = status === 'ACTIVE' || status === 'PARTIALLY_CLOSED';
  return (
    <Badge tone={STATUS_TONE[status]} icon={live ? 'ellipse' : undefined}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const nowListeners = new Set<() => void>();
let nowValue = Date.now();
let nowTimer: ReturnType<typeof setInterval> | null = null;

function subscribeToNow(listener: () => void) {
  nowListeners.add(listener);
  nowValue = Date.now();
  nowTimer ??= setInterval(() => {
    nowValue = Date.now();
    for (const notify of nowListeners) notify();
  }, 30_000);
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

/** One shared clock, so a feed left open never keeps saying "just now" about an old signal. */
function useNow(): number {
  return useSyncExternalStore(
    subscribeToNow,
    () => nowValue,
    () => nowValue,
  );
}

export function Time({ iso }: { iso: string }) {
  const now = useNow();
  const recent = now - new Date(iso).getTime() < 86_400_000;
  return (
    <T v="caption" c="subtle" num numberOfLines={1}>
      {recent ? `${formatClock(iso)} · ${formatRelative(iso, now)}` : formatDateTime(iso)}
    </T>
  );
}

export function PriceCell({
  label,
  value,
  tone,
  strike,
  note,
  big,
  testID,
}: {
  label: string;
  value: string;
  tone?: 'stop' | 'success' | 'update';
  strike?: boolean;
  note?: ReactNode;
  big?: boolean;
  testID?: string;
}) {
  const variant: TextVariant = big ? 'bigPrice' : 'price';
  return (
    <View style={styles.cell} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <T v="caption" c="muted" numberOfLines={1}>
        {label}
      </T>
      <T v={variant} c={tone ?? 'text'} strike={strike} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </T>
      {note && (
        <T v="caption" c="subtle" num>
          {note}
        </T>
      )}
    </View>
  );
}

/** Entry, stop-loss and targets. The same arrangement everywhere, so the eye learns where to look. */
export function Levels({
  precision,
  entryLow,
  entryHigh,
  entryType,
  targets,
  stopLoss,
  originalStopLoss,
  big,
}: {
  precision: number;
  entryLow?: string;
  entryHigh?: string;
  entryType?: 'SINGLE' | 'RANGE';
  targets: Pick<TargetState, 'index' | 'price' | 'status'>[];
  stopLoss: string;
  originalStopLoss?: string;
  big?: boolean;
}) {
  const fmt = (v: string) => formatPrice({ pricePrecision: precision }, v);
  const moved = originalStopLoss !== undefined && originalStopLoss !== stopLoss;
  return (
    <View style={styles.levels}>
      {entryLow !== undefined && (
        <PriceCell
          big={big}
          testID="level-entry"
          label={entryType === 'RANGE' ? 'Entry range' : 'Entry'}
          value={entryType === 'RANGE' ? `${fmt(entryLow)} – ${fmt(entryHigh as string)}` : fmt(entryLow)}
        />
      )}
      <PriceCell
        big={big}
        testID="level-stop"
        label={moved ? 'Stop-loss (now)' : 'Stop-loss'}
        value={fmt(stopLoss)}
        tone="stop"
        note={moved ? `was ${fmt(originalStopLoss)}` : undefined}
      />
      {targets.map((t) => (
        <PriceCell
          key={t.index}
          testID={`level-target-${t.index}`}
          label={t.status === 'HIT' ? `Target ${t.index}, reached` : `Target ${t.index}`}
          value={fmt(t.price)}
          tone={t.status === 'HIT' ? 'success' : undefined}
          strike={t.status === 'HIT'}
        />
      ))}
    </View>
  );
}

function Before({ children }: { children: string }) {
  return (
    <T c="muted" num strike>
      {children}
    </T>
  );
}

function Arrow() {
  const c = useColors();
  return <Ionicons name="arrow-forward" size={14} color={c.subtle} accessibilityLabel="changed to" />;
}

/** Shows a change as before → after, which is what makes an update readable at a glance. */
function ChangeLine({ event }: { event: FeedEvent }) {
  const c = useColors();
  const p = event.payload;
  const fmt = (v: string) => formatPrice({ pricePrecision: p.pricePrecision ?? 2 }, v);
  if (event.type === 'STOP_MOVED' && p.previousStop && p.newStop) {
    const label =
      p.stopKind === 'TRAIL' ? 'Trail stop-loss' : p.stopKind === 'BREAKEVEN' ? 'Stop-loss to breakeven' : 'Stop-loss';
    return (
      <View style={styles.change}>
        <T c="muted">{label}</T>
        <Before>{fmt(p.previousStop)}</Before>
        <Arrow />
        <T v="price" c="stop">
          {fmt(p.newStop)}
        </T>
      </View>
    );
  }
  if (event.type === 'TARGET_HIT' && p.targetPrice) {
    return (
      <View style={styles.change}>
        <Ionicons name="checkmark-circle" size={16} color={c.success} />
        <T c="muted">Target {p.targetIndex} reached at</T>
        <T v="price" c="success">
          {fmt(p.targetPrice)}
        </T>
      </View>
    );
  }
  if (event.type === 'TARGETS_MODIFIED' && p.newTargets) {
    return (
      <View style={styles.change}>
        <T c="muted">Targets</T>
        {p.previousTargets && p.previousTargets.length > 0 && (
          <>
            <Before>{p.previousTargets.map(fmt).join(', ')}</Before>
            <Arrow />
          </>
        )}
        <T v="price">{p.newTargets.map(fmt).join(', ') || 'none'}</T>
      </View>
    );
  }
  if ((event.type === 'PARTIAL_BOOKED' || event.type === 'TRADE_CLOSED') && p.exitPrice) {
    return (
      <View style={styles.change}>
        <T c="muted">{event.type === 'PARTIAL_BOOKED' ? `Booked ${percent(p.fraction ?? '0')} at` : 'Exit at'}</T>
        <T v="price">{fmt(p.exitPrice)}</T>
        {p.movementPoints && (
          <T v="small" c="muted" num>
            {signedPoints(p.movementPoints)} ({basisShort(p.basis)})
          </T>
        )}
      </View>
    );
  }
  if (event.type === 'URGENT_INSTRUCTION' || event.type === 'ANNOUNCEMENT') {
    return <T>{p.message}</T>;
  }
  if (event.type === 'CORRECTION' && p.changes) {
    return (
      <View style={{ gap: 4 }}>
        {p.changes.map((change) => (
          <View key={change.field} style={styles.change}>
            <T c="muted">{change.field}</T>
            <Before>{change.from ?? 'none'}</Before>
            <Arrow />
            <T v="strong" num>
              {change.to ?? 'none'}
            </T>
          </View>
        ))}
        {p.correctionReason && (
          <T v="small" c="muted">
            Reason: {p.correctionReason}
          </T>
        )}
      </View>
    );
  }
  return null;
}

const hasChangeLine = (event: FeedEvent) =>
  ['STOP_MOVED', 'TARGET_HIT', 'TARGETS_MODIFIED', 'PARTIAL_BOOKED', 'TRADE_CLOSED'].includes(event.type);

function toneColor(c: Palette, tone: TemplateTone): string {
  return { BUY: c.buy, SELL: c.sell, UPDATE: c.update, SUCCESS: c.success, STOP: c.stop, NEUTRAL: c.lineStrong }[tone];
}
function toneText(tone: TemplateTone) {
  return ({ BUY: 'buy', SELL: 'sell', UPDATE: 'update', SUCCESS: 'success', STOP: 'stop', NEUTRAL: 'muted' } as const)[
    tone
  ];
}

/** Says in one line what a screen reader user needs, where the card's layout does that for everyone else. */
function feedCardLabel(event: FeedEvent): string {
  const p = event.payload;
  const parts = [categoryLabel(event.category, p.ref)];
  if (event.priority === 'PRIORITY') parts.push('priority');
  parts.push(event.title);
  if (event.body) parts.push(event.body.replace(/\n/g, '. '));
  return parts.join('. ');
}

/** Everything a card in the feed needs. New signals are bold and complete; updates are subordinate. */
export function FeedCard({ event, fresh, adminLink }: { event: FeedEvent; fresh?: boolean; adminLink?: boolean }) {
  const c = useColors();
  const router = useRouter();
  const p = event.payload;
  const isNew = event.category === 'NEW_SIGNAL';
  const direction = p.direction;
  const tone: TemplateTone = isNew && direction ? (direction === 'BUY' ? 'BUY' : 'SELL') : event.tone;
  const urgent = event.priority === 'PRIORITY';

  // New arrivals slide in and glow once, then settle. This is the only motion in the feed.
  const arrive = useRef(new Animated.Value(fresh ? 0 : 1)).current;
  useEffect(() => {
    if (fresh) Animated.spring(arrive, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 180 }).start();
  }, [arrive, fresh]);

  const body = (
    <>
      <View style={[styles.accent, { backgroundColor: toneColor(c, tone) }]} />
      <View style={styles.heading}>
        <T v="label" c={toneText(tone)} style={{ textTransform: 'uppercase', flexShrink: 1 }} numberOfLines={1}>
          {categoryLabel(event.category, p.ref)}
        </T>
        {urgent && (
          <Badge tone="update" icon="warning">
            Priority
          </Badge>
        )}
        <View style={styles.spacer} />
        <Time iso={event.createdAt} />
      </View>
      {event.category === 'ANNOUNCEMENT' ? (
        <View style={styles.announce}>
          <Ionicons name="megaphone-outline" size={18} color={c.muted} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="strong">{event.title}</T>
            <ChangeLine event={event} />
          </View>
        </View>
      ) : (
        <View style={styles.identity}>
          {direction && <DirectionBadge direction={direction} large={isNew} />}
          <T v={isNew ? 'heading' : 'strong'} style={isNew ? { fontWeight: '700' } : undefined}>
            {p.symbol}
          </T>
          {!isNew && event.tradeStatus && <StatusBadge status={event.tradeStatus} />}
          {isNew && event.tradeStatus && event.tradeStatus !== 'PUBLISHED' && (
            <StatusBadge status={event.tradeStatus} />
          )}
          {isNew && event.tradeStatus === 'PUBLISHED' && <Badge tone="update">Awaiting entry</Badge>}
        </View>
      )}
      {isNew && p.after && (
        <Levels
          precision={p.pricePrecision ?? 2}
          entryLow={p.entryLow}
          entryHigh={p.entryHigh}
          entryType={p.entryType}
          targets={p.after.targets}
          stopLoss={p.after.stopLoss}
        />
      )}
      {!isNew && event.category !== 'ANNOUNCEMENT' && (
        <View>
          <ChangeLine event={event} />
          {event.type !== 'CORRECTION' && event.type !== 'URGENT_INSTRUCTION' && !hasChangeLine(event) && (
            <T v="strong">{event.title}</T>
          )}
        </View>
      )}
      {p.comment ? (
        <T v="small" c="muted">
          {p.comment}
        </T>
      ) : null}
    </>
  );
  const cardStyle = [styles.card, { backgroundColor: c.surface, borderColor: urgent ? c.update : c.line }];
  const animated = {
    opacity: arrive,
    transform: [{ translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }],
  };
  if (!event.tradeId) {
    return <Animated.View style={[cardStyle, animated]}>{body}</Animated.View>;
  }
  const href = adminLink ? `/admin/trades/${event.tradeId}` : `/trades/${event.tradeId}`;
  return (
    <Animated.View style={animated}>
      <Pressable
        testID={`feed-card-${event.seq}`}
        accessibilityRole="button"
        accessibilityLabel={feedCardLabel(event)}
        accessibilityHint="Opens this trade"
        onPress={() => router.push(href)}
        style={({ pressed }) => [cardStyle, pressed && { opacity: 0.8 }]}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}

export function TradeCard({ trade, href }: { trade: TradeSummary; href: string }) {
  const c = useColors();
  const router = useRouter();
  return (
    <Pressable
      testID={`trade-${trade.ref}`}
      accessibilityRole="button"
      accessibilityLabel={`${trade.direction} ${trade.symbol}, ${STATUS_LABELS[trade.status]}, reference ${trade.ref}`}
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.surface, borderColor: c.line },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: trade.direction === 'BUY' ? c.buy : c.sell }]} />
      <View style={styles.identity}>
        <DirectionBadge direction={trade.direction} large />
        <T v="heading" style={{ fontWeight: '700' }}>
          {trade.symbol}
        </T>
        <StatusBadge status={trade.status} />
        {trade.priority === 'PRIORITY' && <Badge tone="update">Priority</Badge>}
        <View style={styles.spacer} />
        <T v="caption" c="subtle" num>
          {trade.ref}
        </T>
      </View>
      <Levels
        precision={trade.pricePrecision}
        entryLow={trade.entryLow}
        entryHigh={trade.entryHigh}
        entryType={trade.entryType}
        targets={trade.targets}
        stopLoss={trade.stopLoss}
        originalStopLoss={trade.originalStopLoss}
      />
      <View style={[styles.latest, { borderTopColor: c.line }]}>
        <T v="small" c="muted" numberOfLines={1} style={{ flex: 1 }}>
          {trade.updatesCount > 0 ? `Latest: ${trade.lastEventTitle}` : 'No updates yet'}
        </T>
        {trade.lastEventAt && <Time iso={trade.lastEventAt} />}
      </View>
    </Pressable>
  );
}

/** Oldest first, with the original signal clearly separate from everything that changed after it. */
export function Timeline({
  events,
  renderExtra,
}: {
  events: FeedEvent[];
  renderExtra?: (event: FeedEvent) => ReactNode;
}) {
  const c = useColors();
  return (
    <View>
      {events.map((event, index) => {
        const isOriginal = event.category === 'NEW_SIGNAL';
        const tone: TemplateTone = isOriginal ? (event.payload.direction === 'SELL' ? 'SELL' : 'BUY') : event.tone;
        const last = index === events.length - 1;
        return (
          <View key={event.seq} style={styles.timelineRow} testID={`timeline-${event.type}`}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, { backgroundColor: toneColor(c, tone) }]} />
              {!last && <View style={[styles.timelineLine, { backgroundColor: c.line }]} />}
            </View>
            <View style={[styles.timelineBody, last && { paddingBottom: 0 }]}>
              <T v="strong">{isOriginal ? 'Original signal' : event.title}</T>
              <T v="caption" c="subtle" num>
                {formatDateTime(event.createdAt)}
              </T>
              <View style={{ marginTop: 4, gap: 2 }}>
                {isOriginal ? (
                  <T v="small" c="muted">
                    {event.body}
                  </T>
                ) : (
                  <ChangeLine event={event} />
                )}
                {!isOriginal && event.payload.comment ? (
                  <T v="small" c="muted">
                    {event.payload.comment}
                  </T>
                ) : null}
              </View>
              {renderExtra?.(event)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** What a subscriber is told about an outcome. Explicitly not a statement of their own result. */
export function OutcomeSummary({ outcome, precision }: { outcome: PublicOutcome; precision: number }) {
  const c = useColors();
  const label = { WIN: 'Favourable', LOSS: 'Unfavourable', BREAKEVEN: 'Breakeven', UNRESOLVED: 'Not measured' }[
    outcome.outcome
  ];
  const tone = ({ WIN: 'success', LOSS: 'stop', BREAKEVEN: 'neutral', UNRESOLVED: 'neutral' } as const)[
    outcome.outcome
  ];
  return (
    <View style={[styles.outcome, { backgroundColor: c.raised }]} testID="outcome">
      <View style={styles.identity}>
        <Badge tone={tone}>{label}</Badge>
        {outcome.reason && (
          <T v="small" c="muted">
            {CLOSE_REASON_LABELS[outcome.reason]}
          </T>
        )}
      </View>
      <View style={styles.levels}>
        {outcome.averageExit && (
          <PriceCell label="Average exit" value={formatPrice({ pricePrecision: precision }, outcome.averageExit)} />
        )}
        {outcome.weightedPoints && <PriceCell label="Move recorded" value={signedPoints(outcome.weightedPoints)} />}
        {outcome.closedFraction !== '1' && <PriceCell label="Closed so far" value={percent(outcome.closedFraction)} />}
      </View>
      <T v="caption" c="subtle">
        {BASIS_LABELS[outcome.basis]}. This describes the signal, not what any subscriber achieved. Your result depends
        on your own entry, size and costs.
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  direction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cell: { flexBasis: '46%', flexGrow: 1, minWidth: 0 },
  levels: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.md },
  change: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingLeft: space.lg + 2,
    paddingRight: space.lg,
    gap: space.md,
    overflow: 'hidden',
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  spacer: { flexGrow: 1 },
  identity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  announce: { flexDirection: 'row', gap: space.sm },
  latest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  timelineRow: { flexDirection: 'row', gap: space.md },
  timelineRail: { width: 10, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  timelineLine: { flex: 1, width: StyleSheet.hairlineWidth * 2, marginTop: 4 },
  timelineBody: { flex: 1, minWidth: 0, paddingBottom: space.lg },
  outcome: { gap: space.md, padding: space.md, borderRadius: radius.md },
});
