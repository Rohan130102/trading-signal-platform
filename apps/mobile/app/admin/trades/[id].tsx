import Ionicons from '@expo/vector-icons/Ionicons';
import {
  type AdminEvent,
  type AdminTradeDetail,
  CLOSE_REASON_LABELS,
  formatDateTime,
  formatPrice,
  money,
  percent,
  signedPoints,
  TERMINAL_STATUSES,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DispatchStatus } from '@/admin/parts';
import { RemoveTradeSheet } from '@/admin/RemoveTrade';
import { ActionSheet, type ActionKind } from '@/admin/TradeActions';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { DirectionBadge, Levels, StatusBadge, Timeline } from '@/trade';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  ConnectionBanner,
  Divider,
  ErrorState,
  type IconName,
  errorMessage,
  Loading,
  Notice,
  Screen,
  SectionTitle,
  Stat,
  T,
  useToast,
} from '@/ui';

const ACTIONS: { kind: ActionKind; label: string; icon: IconName; tone?: 'primary' | 'danger' }[] = [
  { kind: 'ACTIVATE', label: 'Activate Trade', icon: 'play', tone: 'primary' },
  { kind: 'MOVE_STOP', label: 'Update Stop-Loss', icon: 'shield-checkmark-outline' },
  { kind: 'MOVE_STOP_BREAKEVEN', label: 'Breakeven', icon: 'flag-outline' },
  { kind: 'TRAIL_STOP', label: 'Trail Stop', icon: 'trending-up' },
  { kind: 'TARGET_HIT', label: 'Target Reached', icon: 'locate-outline' },
  { kind: 'BOOK_PARTIAL', label: 'Book Partial', icon: 'checkmark-done-outline' },
  { kind: 'CLOSE', label: 'Close Trade', icon: 'checkmark-circle-outline', tone: 'primary' },
  { kind: 'URGENT', label: 'Urgent', icon: 'warning-outline' },
  { kind: 'MODIFY_TARGETS', label: 'Change Targets', icon: 'create-outline' },
  { kind: 'RECORD_EXECUTION', label: 'My Execution', icon: 'lock-closed-outline' },
  { kind: 'CANCEL', label: 'Cancel Signal', icon: 'ban-outline', tone: 'danger' },
  { kind: 'EXPIRE', label: 'Expired, No Entry', icon: 'close-circle-outline' },
  { kind: 'CORRECT', label: 'Correct Trade', icon: 'build-outline' },
];

function LockIcon() {
  const c = useColors();
  return <Ionicons name="lock-closed-outline" size={14} color={c.muted} />;
}

function ActionButton({ action, onPress }: { action: (typeof ACTIONS)[number]; onPress: () => void }) {
  const c = useColors();
  const primary = action.tone === 'primary';
  const danger = action.tone === 'danger';
  const fg = primary ? c.primaryText : danger ? c.stop : c.text;
  return (
    <Pressable
      testID={`do-${action.kind}`}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: primary ? c.primary : danger ? c.stopSoft : c.raised,
          borderColor: c.line,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Ionicons name={action.icon} size={18} color={fg} />
      <T v="small" numberOfLines={2} style={{ color: fg, fontWeight: '600', flexShrink: 1 }}>
        {action.label}
      </T>
    </Pressable>
  );
}

export default function AdminTrade() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const trade = useQuery({
    queryKey: ['admin', 'trade', id],
    queryFn: () => api.get<AdminTradeDetail>(`/admin/trades/${id}`),
    refetchInterval: (query) =>
      query.state.data?.events.some(
        (e) => e.dispatch && (e.dispatch.stage === 'PENDING' || e.dispatch.stage === 'IN_PROGRESS'),
      )
        ? 1500
        : 15_000,
  });
  const [action, setAction] = useState<ActionKind | null>(null);
  const [removing, setRemoving] = useState(false);
  const master = useSession().me?.isMasterAdmin === true;
  const client = useQueryClient();
  const toast = useToast();
  const restore = useMutation({
    mutationFn: () => api.post('/admin/trade-removals/restore', { tradeIds: [id] }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      toast({ tone: 'success', title: 'Back on subscriber screens' });
    },
    onError: (error) => toast({ tone: 'error', title: 'Not restored', body: errorMessage(error) }),
  });
  const t = trade.data;
  const available = useMemo(() => (t?.allowedActions ?? []) as ActionKind[], [t?.allowedActions]);
  const refresh = useCallback(() => trade.refetch(), [trade]);
  const shown = ACTIONS.filter((a) => available.includes(a.kind));
  const finished = t ? TERMINAL_STATUSES.includes(t.status) : false;
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="admin-trade">
      <Stack.Screen options={{ title: t?.ref ?? 'Trade' }} />
      {trade.isPending && <Loading rows={3} label="Loading trade" />}
      {trade.isError && !t && (
        <ErrorState
          error={trade.error}
          title={
            trade.error instanceof ApiError && trade.error.status === 404 ? 'That trade does not exist' : undefined
          }
          onRetry={() => void trade.refetch()}
        />
      )}
      {t && (
        <>
          <ConnectionBanner />
          <View style={styles.identity}>
            <DirectionBadge direction={t.direction} large />
            <T v="title" accessibilityRole="header">
              {t.symbol}
            </T>
            <StatusBadge status={t.status} />
            {t.priority === 'PRIORITY' && <Badge tone="update">Priority</Badge>}
          </View>
          <T v="small" c="muted" num>
            Published {formatDateTime(t.publishedAt)} · Version {t.version}
          </T>
          {t.removal && (
            <View style={{ gap: space.sm }} testID="removed-banner">
              <Notice tone="stop" icon="eye-off-outline" title="Removed from subscriber screens">
                {`By ${t.removal.removedBy}, ${formatDateTime(t.removal.removedAt)}: “${t.removal.reason}”. Still counted in performance figures. Nothing can change until it is put back.`}
              </Notice>
              {master && (
                <Button
                  testID="restore-trade"
                  label="Put back on screens"
                  icon="eye-outline"
                  loading={restore.isPending}
                  onPress={() => restore.mutate()}
                />
              )}
            </View>
          )}
          <Card style={{ gap: space.md }}>
            <Levels
              big
              precision={t.pricePrecision}
              entryLow={t.entryLow}
              entryHigh={t.entryHigh}
              entryType={t.entryType}
              targets={t.targets}
              stopLoss={t.stopLoss}
              originalStopLoss={t.originalStopLoss}
            />
            {t.execution && (
              <>
                <Divider />
                <View style={styles.identity}>
                  <LockIcon />
                  <T v="small" c="muted" num style={{ flex: 1 }}>
                    {`Your entry ${formatPrice(t, t.execution.entryPrice)}${t.execution.quantity ? `, quantity ${t.execution.quantity} ${t.unitLabel}` : ''}. Only administrators see this.`}
                  </T>
                </View>
              </>
            )}
          </Card>
          {shown.length > 0 && (
            <>
              <SectionTitle>Actions</SectionTitle>
              {finished && (
                <T v="small" c="muted">
                  This trade is finished. You can still correct a published error.
                </T>
              )}
              <View style={styles.actions}>
                {shown.map((a) => (
                  <ActionButton key={a.kind} action={a} onPress={() => setAction(a.kind)} />
                ))}
              </View>
            </>
          )}
          {t.aggregate && (
            <>
              <SectionTitle>Result</SectionTitle>
              <Card style={{ gap: space.md }} testID="trade-result">
                <View style={styles.stats}>
                  <Stat label="Closed" value={percent(t.aggregate.closedFraction)} />
                  <Stat
                    label="Average exit"
                    value={t.aggregate.averageExit ? formatPrice(t, t.aggregate.averageExit) : 'n/a'}
                  />
                  <Stat
                    label="Move, weighted by portion"
                    value={t.aggregate.weightedPoints ? signedPoints(t.aggregate.weightedPoints) : 'Not measured'}
                  />
                  <Stat
                    label="Net result"
                    value={t.aggregate.netPnl ? money(t.aggregate.netPnl, t.quoteCurrency) : 'None'}
                    hint={
                      t.aggregate.netPnl
                        ? t.aggregate.grossPnl
                          ? `Gross ${money(t.aggregate.grossPnl, t.quoteCurrency)}`
                          : undefined
                        : 'No position recorded'
                    }
                  />
                </View>
                {t.closures.map((closure) => (
                  <View key={closure.id} style={{ gap: 2 }}>
                    <Divider style={{ marginBottom: space.sm }} />
                    <T v="strong" strike={closure.superseded}>
                      {`${closure.kind === 'FINAL' ? 'Final' : 'Partial'} exit at ${formatPrice(t, closure.exitPrice)}${closure.superseded ? ' (corrected)' : ''}`}
                    </T>
                    <T v="small" c="muted" num>
                      {[
                        percent(closure.fraction, 2),
                        closure.reason ? CLOSE_REASON_LABELS[closure.reason] : null,
                        closure.points ? signedPoints(closure.points) : null,
                        closure.netPnl ? money(closure.netPnl, t.quoteCurrency) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </T>
                    <T v="caption" c="subtle" num>
                      {formatDateTime(closure.exitedAt)}
                    </T>
                  </View>
                ))}
              </Card>
            </>
          )}
          <SectionTitle>Timeline</SectionTitle>
          <Card>
            <Timeline
              events={t.events}
              renderExtra={(event) => {
                const e = event as AdminEvent;
                return (
                  <View style={{ marginTop: space.sm, gap: 4, alignItems: 'flex-start' }}>
                    {e.broadcast ? (
                      <DispatchStatus dispatch={e.dispatch} />
                    ) : (
                      <Badge icon="lock-closed">Internal, not sent</Badge>
                    )}
                    <T v="caption" c="subtle">
                      {e.actorName ? `By ${e.actorName}` : 'By the system'}
                    </T>
                  </View>
                );
              }}
            />
          </Card>
          {master && finished && !t.removal && (
            <Button
              testID="remove-trade-open"
              label="Remove from subscriber screens"
              icon="eye-off-outline"
              variant="danger"
              onPress={() => setRemoving(true)}
            />
          )}
          <Button
            testID="publish-similar"
            label={`New signal on ${t.symbol}`}
            icon="add"
            onPress={() => router.push({ pathname: '/compose', params: { symbol: t.symbol, direction: t.direction } })}
          />
          {action && <ActionSheet key={action} trade={t} kind={action} onClose={() => setAction(null)} />}
          {removing && <RemoveTradeSheet trade={t} onClose={() => setRemoving(false)} />}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
});
