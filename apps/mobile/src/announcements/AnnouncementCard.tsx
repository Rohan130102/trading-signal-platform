import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ANNOUNCEMENT_CATEGORY_LABELS,
  type AnnouncementCategory,
  type AnnouncementView,
  formatDateTime,
  isSafeAnnouncementLink,
} from '@signaldesk/domain';
import { memo } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useColors } from '@/theme';
import type { Palette } from '@/theme/tokens';
import { radius, space } from '@/theme/tokens';
import { Badge, T, type Tone } from '@/ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const CATEGORY_LOOK: Record<AnnouncementCategory, { icon: IconName; tone: Tone }> = {
  GENERAL: { icon: 'megaphone-outline', tone: 'neutral' },
  IMPORTANT: { icon: 'alert-circle-outline', tone: 'update' },
  MARKET_UPDATE: { icon: 'stats-chart-outline', tone: 'update' },
  MAINTENANCE: { icon: 'construct-outline', tone: 'neutral' },
  EDUCATIONAL: { icon: 'school-outline', tone: 'neutral' },
  URGENT: { icon: 'warning-outline', tone: 'stop' },
};

function accent(category: AnnouncementCategory, c: Palette): string {
  return category === 'URGENT' ? c.stop : category === 'IMPORTANT' || category === 'MARKET_UPDATE' ? c.update : c.lineStrong;
}

/** Links open in the browser after a confirmation, and only https links are ever shown. */
export function openAnnouncementLink(url: string): void {
  if (!isSafeAnnouncementLink(url)) return;
  const host = new URL(url).hostname;
  Alert.alert('Open link?', `This opens ${host} in your browser.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open', onPress: () => void Linking.openURL(url).catch(() => undefined) },
  ]);
}

export const AnnouncementCard = memo(function AnnouncementCard({
  item,
  preview,
  onMenu,
}: {
  item: AnnouncementView;
  preview?: boolean;
  onMenu?: (item: AnnouncementView) => void;
}) {
  const c = useColors();
  const look = CATEGORY_LOOK[item.category];
  return (
    <View
      testID={preview ? 'announcement-preview' : `announcement-${item.id}`}
      style={[styles.card, { backgroundColor: c.surface, borderColor: item.category === 'URGENT' ? c.stop : c.line }]}
    >
      <View style={[styles.accent, { backgroundColor: accent(item.category, c) }]} />
      <View style={styles.head}>
        <Badge tone={look.tone} icon={look.icon}>
          {ANNOUNCEMENT_CATEGORY_LABELS[item.category]}
        </Badge>
        {item.pinned && (
          <View accessibilityLabel="Pinned" style={styles.pin}>
            <Ionicons name="pin" size={14} color={c.muted} />
          </View>
        )}
        {item.priority === 'PRIORITY' && item.category !== 'URGENT' && (
          <Badge tone="update" icon="warning">
            Priority
          </Badge>
        )}
        <View style={styles.spacer} />
        {onMenu && (
          <Pressable
            testID={`announcement-menu-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${item.title}`}
            onPress={() => onMenu(item)}
            style={({ pressed }) => [styles.menu, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={c.muted} />
          </Pressable>
        )}
      </View>
      <T v="heading" accessibilityRole="header">
        {item.title}
      </T>
      <T selectable={!preview}>{item.body}</T>
      {item.linkUrl && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={item.linkLabel ?? 'Open link'}
          accessibilityHint={`Opens ${item.linkUrl}`}
          disabled={preview}
          onPress={() => openAnnouncementLink(item.linkUrl as string)}
          style={({ pressed }) => [styles.link, { borderColor: c.lineStrong, opacity: pressed ? 0.7 : 1 }]}
        >
          <T v="strong">{item.linkLabel ?? 'Open link'}</T>
          <Ionicons name="open-outline" size={16} color={c.text} />
        </Pressable>
      )}
      <T v="caption" c="subtle" num>
        {preview ? 'Preview: this is how subscribers will see it' : formatDateTime(item.publishedAt)}
        {!preview && item.editedAt ? ' · edited' : ''}
        {item.expiresAt ? ` · until ${formatDateTime(item.expiresAt)}` : ''}
      </T>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingLeft: space.lg + 2,
    paddingRight: space.md,
    gap: space.sm,
    overflow: 'hidden',
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  pin: { paddingHorizontal: 2 },
  spacer: { flexGrow: 1 },
  menu: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -8, marginRight: -6 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
