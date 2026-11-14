import { type DispatchSummary, formatPrice, type SubscriberRow, type TradeSummary } from '@signaldesk/domain';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { DirectionBadge, StatusBadge } from '@/trade';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Badge, Button, Notice, T, type Tone } from '@/ui';

export function TradeRow({ trade }: { trade: TradeSummary }) {
  const c = useColors();
  const router = useRouter();
  return (
    <Pressable
      testID={`trade-${trade.ref}`}
      accessibilityRole="button"
      accessibilityLabel={`${trade.direction} ${trade.symbol}, reference ${trade.ref}, ${trade.stopLoss === null ? 'upcoming' : `stop-loss ${formatPrice(trade, trade.stopLoss)}`}`}
      onPress={() => router.push(`/admin/trades/${trade.id}`)}
      style={({ pressed }) => [
        styles.tradeRow,
        { backgroundColor: c.surface, borderColor: c.line },
        pressed && { opacity: 0.75 },
      ]}
    >
      <View style={styles.tradeTop}>
        <DirectionBadge direction={trade.direction} />
        <T v="strong">{trade.symbol}</T>
        <StatusBadge status={trade.status} />
        <View style={{ flexGrow: 1 }} />
        <T v="caption" c="subtle" num>
          {trade.ref}
        </T>
      </View>
      <View style={styles.tradeTop}>
        <T v="small" c="muted">
          {trade.stopLoss === null ? 'Upcoming, levels at activation' : 'Stop-loss'}
        </T>
        {trade.stopLoss !== null && (
          <T v="small" c="stop" num style={{ fontWeight: '600' }}>
            {formatPrice(trade, trade.stopLoss)}
          </T>
        )}
        <View style={{ flexGrow: 1 }} />
        <Ionicons name="chevron-forward" size={14} color={c.subtle} />
      </View>
    </Pressable>
  );
}

const STAGES: Record<DispatchSummary['stage'], { label: string; tone: Tone }> = {
  PENDING: { label: 'Push queued', tone: 'neutral' },
  IN_PROGRESS: { label: 'Sending push', tone: 'update' },
  COMPLETED: { label: 'Handed to push services', tone: 'success' },
  FAILED: { label: 'Push failures', tone: 'stop' },
};

/** Always worded as what the transport did. Nothing here claims a person received anything. */
export function DispatchStatus({ dispatch }: { dispatch: DispatchSummary | null }) {
  if (!dispatch) return null;
  const stage = STAGES[dispatch.stage];
  const parts: string[] = [`Live to ${dispatch.liveSends} connected`];
  if (dispatch.devices > 0) {
    parts.push(`${dispatch.accepted}/${dispatch.devices} devices accepted`);
    if (dispatch.failed > 0) parts.push(`${dispatch.failed} failed`);
    if (dispatch.invalidated > 0) parts.push(`${dispatch.invalidated} gone`);
    if (dispatch.skipped > 0) parts.push(`${dispatch.skipped} skipped`);
  } else if (dispatch.stage === 'COMPLETED') {
    parts.push('No devices have notifications on');
  }
  return (
    <View style={{ gap: 4, alignItems: 'flex-start' }} testID="dispatch-status">
      <Badge tone={stage.tone}>{stage.label}</Badge>
      <T v="caption" c="muted" num>
        {parts.join(' · ')}
      </T>
    </View>
  );
}

export function AccessBadge({ row }: { row: Pick<SubscriberRow, 'status' | 'subscription'> }) {
  if (row.status !== 'ACTIVE')
    return <Badge tone="stop">{row.status === 'SUSPENDED' ? 'Suspended' : 'Disabled'}</Badge>;
  const { state, daysRemaining } = row.subscription;
  if (state === 'ACTIVE') {
    return (
      <Badge tone={daysRemaining <= 7 ? 'update' : 'success'}>
        {daysRemaining <= 7 ? `${daysRemaining}d left` : 'Active'}
      </Badge>
    );
  }
  if (state === 'SCHEDULED') return <Badge tone="buy">Scheduled</Badge>;
  if (state === 'EXPIRED') return <Badge tone="stop">Expired</Badge>;
  return <Badge>None</Badge>;
}

/** A temporary password appears once. Sharing it should be one tap, with no retyping. */
export function CredentialsCard({
  loginId,
  password,
  validFor = '3 days',
}: {
  loginId: string;
  password: string;
  validFor?: string;
}) {
  const c = useColors();
  const [copied, setCopied] = useState(false);
  const message = `Your login ID: ${loginId}\nYour temporary password: ${password}\nIt works for ${validFor} and you will be asked to change it when you first sign in.`;
  return (
    <View style={{ gap: space.md }} testID="credentials">
      <Notice tone="update">Shown only this once. It is not stored in readable form, so send it now.</Notice>
      <View style={[styles.credentials, { backgroundColor: c.raised }]}>
        <T v="caption" c="muted">
          Login ID
        </T>
        <T v="strong" num selectable testID="credential-login">
          {loginId}
        </T>
        <T v="caption" c="muted" style={{ marginTop: space.sm }}>
          Temporary password
        </T>
        <T v="title" num selectable testID="temp-password">
          {password}
        </T>
      </View>
      <Button
        label="Send to them"
        icon="share-outline"
        variant="primary"
        onPress={() => void Share.share({ message })}
      />
      <Button
        label={copied ? 'Copied' : 'Copy message'}
        icon={copied ? 'checkmark' : 'copy-outline'}
        onPress={() => {
          void Clipboard.setStringAsync(message);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tradeRow: { padding: space.md, gap: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  tradeTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  credentials: { padding: space.md, borderRadius: radius.md, gap: 2 },
});
