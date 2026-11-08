import Ionicons from '@expo/vector-icons/Ionicons';
import {
  type AdminAnnouncement,
  type AdminAnnouncementsPage,
  type AdminAnnouncementView,
  ANNOUNCEMENT_CATEGORY_LABELS,
  formatDateTime,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CATEGORY_LOOK } from '@/announcements/AnnouncementCard';
import { api, queryString } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import {
  ActionSheet,
  Badge,
  Button,
  ChipRow,
  Chip,
  EmptyState,
  ErrorState,
  errorMessage,
  Field,
  Loading,
  Refresh,
  Sheet,
  T,
  useRefresh,
  useToast,
} from '@/ui';

type Bulk = 'ARCHIVE' | 'RESTORE' | 'DELETE';
const VIEWS: { value: AdminAnnouncementView; label: string; count?: keyof AdminAnnouncementsPage['counts'] }[] = [
  { value: 'LIVE', label: 'Live', count: 'LIVE' },
  { value: 'SCHEDULED', label: 'Scheduled', count: 'SCHEDULED' },
  { value: 'DRAFT', label: 'Drafts', count: 'DRAFT' },
  { value: 'ARCHIVED', label: 'Archived', count: 'ARCHIVED' },
  { value: 'BIN', label: 'Bin', count: 'BIN' },
];

function statusLine(a: AdminAnnouncement): string {
  if (a.deleted) return `In the bin since ${formatDateTime(a.deletedAt as string)}`;
  if (a.status === 'SCHEDULED') return `Goes out ${formatDateTime(a.publishAt as string)}`;
  if (a.status === 'DRAFT') return `Draft, edited ${formatDateTime(a.updatedAt)}`;
  if (a.status === 'ARCHIVED') return `Archived ${formatDateTime(a.archivedAt as string)}`;
  return `Sent ${formatDateTime(a.publishedAt as string)}${a.editedAt ? ', edited since' : ''}`;
}

/** A confirmation that has to be typed, for the one action that cannot be undone. */
function TypedConfirm({ title, onConfirm, onClose }: { title: string; onConfirm: () => void; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Sheet
      title="Delete permanently?"
      subtitle={title}
      onClose={onClose}
      footer={
        <Button
          label="Delete permanently"
          variant="danger"
          testID="purge-confirm"
          disabled={typed.trim().toUpperCase() !== 'DELETE'}
          onPress={() => {
            onClose();
            onConfirm();
          }}
        />
      }
    >
      <T c="muted">This announcement was never sent, so it can be removed completely. This cannot be undone.</T>
      <Field label="Type DELETE to confirm" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} testID="purge-typed" />
    </Sheet>
  );
}

export default function Announcements() {
  const c = useColors();
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<AdminAnnouncementView>('LIVE');
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<AdminAnnouncement | null>(null);
  const [purging, setPurging] = useState<AdminAnnouncement | null>(null);

  const list = useQuery({
    queryKey: ['admin', 'announcements', view, query.trim()],
    queryFn: () => api.get<AdminAnnouncementsPage>(`/admin/announcements${queryString({ view, q: query.trim() })}`),
  });
  const rows = useMemo(() => list.data?.announcements ?? [], [list.data]);
  const pull = useRefresh(useCallback(() => list.refetch(), [list]));

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['admin', 'announcements'] });
    void client.invalidateQueries({ queryKey: ['announcements'] });
  };
  const fail = (error: unknown) => {
    haptics.notify('error');
    toast({ tone: 'error', title: 'That did not work', body: errorMessage(error) });
  };

  const single = useMutation({
    mutationFn: async ({ a, action }: { a: AdminAnnouncement; action: 'publish' | 'unschedule' | 'archive' | 'restore' | 'delete' | 'purge' }) => {
      const body = { expectedVersion: a.version };
      if (action === 'delete') return api.delete(`/admin/announcements/${a.id}`, body);
      if (action === 'purge') return api.post(`/admin/announcements/${a.id}/purge`, { ...body, confirm: 'PERMANENTLY_DELETE' });
      return api.post(`/admin/announcements/${a.id}/${action}`, body);
    },
    onSuccess: (_d, { action }) => {
      haptics.notify('success');
      toast({
        tone: 'success',
        title: {
          publish: 'Sent to subscribers',
          unschedule: 'Schedule cancelled, kept as a draft',
          archive: 'Archived',
          restore: 'Restored',
          delete: 'Moved to the bin',
          purge: 'Deleted permanently',
        }[action],
      });
      refresh();
    },
    onError: fail,
  });

  const bulk = useMutation({
    mutationFn: ({ action, ids }: { action: Bulk; ids: string[] }) =>
      api.post<{ changed: number }>('/admin/announcements/bulk', { ids, action, expectedCount: ids.length }),
    onSuccess: (result) => {
      haptics.notify('success');
      toast({ tone: 'success', title: `${result.changed} updated` });
      setSelected(new Set());
      setSelecting(false);
      refresh();
    },
    onError: fail,
  });

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const bulkActions = useMemo(() => {
    const can = (a: 'ARCHIVE' | 'RESTORE' | 'DELETE') =>
      selectedRows.length > 0 && selectedRows.every((r) => r.allowedActions.includes(a));
    return (['ARCHIVE', 'RESTORE', 'DELETE'] as const).filter(can);
  }, [selectedRows]);

  const confirmBulk = (action: Bulk) => {
    const n = selectedRows.length;
    const words = { ARCHIVE: 'Archive', RESTORE: 'Restore', DELETE: 'Move to the bin' }[action];
    Alert.alert(`${words}: ${n} announcement${n === 1 ? '' : 's'}?`, action === 'DELETE' ? 'They can be restored from the bin.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: words, style: action === 'DELETE' ? 'destructive' : 'default', onPress: () => bulk.mutate({ action, ids: selectedRows.map((r) => r.id) }) },
    ]);
  };

  const confirmPublish = (a: AdminAnnouncement) =>
    Alert.alert('Send now?', 'It goes to every subscriber with access, as an alert and on the News tab.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send now', onPress: () => single.mutate({ a, action: 'publish' }) },
    ]);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={selecting ? 'Done selecting' : 'Select several'}
                testID="announcements-select"
                onPress={() => {
                  setSelecting((s) => !s);
                  setSelected(new Set());
                }}
                style={styles.headerButton}
              >
                <T v="strong">{selecting ? 'Done' : 'Select'}</T>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New announcement"
                testID="announcements-new"
                onPress={() => router.push('/admin/announcement')}
                style={styles.headerButton}
              >
                <Ionicons name="add" size={26} color={c.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <FlatList
        testID="admin-announcements"
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={styles.list}
        refreshControl={<Refresh {...pull} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <ChipRow>
              {VIEWS.map((v) => {
                const count = v.count ? list.data?.counts[v.count] : undefined;
                return (
                  <Chip
                    key={v.value}
                    testID={`view-${v.value}`}
                    label={count !== undefined ? `${v.label} ${count}` : v.label}
                    on={view === v.value}
                    onPress={() => {
                      setView(v.value);
                      setSelected(new Set());
                    }}
                  />
                );
              })}
            </ChipRow>
            <Field label="Search" value={query} onChangeText={setQuery} autoCorrect={false} />
          </View>
        }
        ListEmptyComponent={
          list.isPending ? (
            <Loading rows={3} label="Loading announcements" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState icon="megaphone-outline" title="Nothing here">
              {view === 'BIN' ? 'Announcements moved to the bin appear here.' : 'Create one with the + button.'}
            </EmptyState>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          const look = CATEGORY_LOOK[item.category];
          return (
            <Pressable
              testID={`admin-announcement-${item.id}`}
              accessibilityRole={selecting ? 'checkbox' : 'button'}
              accessibilityState={selecting ? { checked: on } : undefined}
              accessibilityLabel={`${item.title}. ${statusLine(item)}`}
              onPress={() => {
                if (selecting) {
                  haptics.selection();
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  });
                } else if (item.allowedActions.includes('EDIT')) router.push(`/admin/announcement?id=${item.id}`);
                else setMenuFor(item);
              }}
              onLongPress={() => setMenuFor(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: c.surface, borderColor: on ? c.primary : c.line, opacity: pressed ? 0.8 : 1 }]}
            >
              {selecting && (
                <View style={[styles.check, { borderColor: on ? c.primary : c.lineStrong, backgroundColor: on ? c.primary : 'transparent' }]}>
                  {on && <Ionicons name="checkmark" size={16} color={c.primaryText} />}
                </View>
              )}
              <View style={styles.flex}>
                <View style={styles.line}>
                  <Badge tone={look.tone} icon={look.icon}>
                    {ANNOUNCEMENT_CATEGORY_LABELS[item.category]}
                  </Badge>
                  {item.pinned && <Ionicons name="pin" size={14} color={c.muted} accessibilityLabel="Pinned" />}
                  {item.priority === 'PRIORITY' && <Badge tone="update">Priority</Badge>}
                </View>
                <T v="strong" numberOfLines={2}>
                  {item.title}
                </T>
                <T v="caption" c="subtle" num numberOfLines={1}>
                  {statusLine(item)}
                  {item.createdByName ? ` · ${item.createdByName}` : ''}
                </T>
              </View>
              {!selecting && (
                <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${item.title}`} onPress={() => setMenuFor(item)} style={styles.menu} testID={`admin-announcement-menu-${item.id}`}>
                  <Ionicons name="ellipsis-horizontal" size={20} color={c.muted} />
                </Pressable>
              )}
            </Pressable>
          );
        }}
      />
      {selecting && (
        <View style={[styles.bulkBar, { backgroundColor: c.surface, borderTopColor: c.line }]}>
          <T v="strong" style={styles.flex}>
            {selected.size} selected
          </T>
          {bulkActions.length === 0 && selected.size > 0 && (
            <T v="small" c="muted">
              No shared action
            </T>
          )}
          {bulkActions.map((action) => (
            <Button
              key={action}
              small
              label={{ ARCHIVE: 'Archive', RESTORE: 'Restore', DELETE: 'Bin' }[action]}
              variant={action === 'DELETE' ? 'danger' : 'secondary'}
              loading={bulk.isPending}
              onPress={() => confirmBulk(action)}
            />
          ))}
        </View>
      )}
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.title ?? ''}
        subtitle={menuFor ? statusLine(menuFor) : undefined}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                ...(menuFor.allowedActions.includes('EDIT') ? [{ label: 'Edit', icon: 'create-outline' as const, onPress: () => router.push(`/admin/announcement?id=${menuFor.id}`) }] : []),
                ...(menuFor.allowedActions.includes('PUBLISH') ? [{ label: 'Send now', icon: 'send-outline' as const, testID: 'announcement-publish', onPress: () => confirmPublish(menuFor) }] : []),
                ...(menuFor.allowedActions.includes('UNSCHEDULE') ? [{ label: 'Cancel the schedule', icon: 'calendar-clear-outline' as const, hint: 'Keeps it as a draft.', onPress: () => single.mutate({ a: menuFor, action: 'unschedule' }) }] : []),
                ...(menuFor.allowedActions.includes('ARCHIVE') ? [{ label: 'Archive', icon: 'archive-outline' as const, hint: 'Off the News tab. Stays in the record.', onPress: () => single.mutate({ a: menuFor, action: 'archive' }) }] : []),
                ...(menuFor.allowedActions.includes('RESTORE') ? [{ label: 'Restore', icon: 'arrow-undo-outline' as const, testID: 'announcement-restore', onPress: () => single.mutate({ a: menuFor, action: 'restore' }) }] : []),
                ...(menuFor.allowedActions.includes('DELETE')
                  ? [{ label: 'Move to the bin', icon: 'trash-outline' as const, danger: true, hint: 'Restorable from the bin.', onPress: () => single.mutate({ a: menuFor, action: 'delete' }) }]
                  : []),
                ...(menuFor.allowedActions.includes('PURGE')
                  ? [{ label: 'Delete permanently', icon: 'close-circle-outline' as const, danger: true, hint: 'Only possible because it was never sent.', testID: 'announcement-purge', onPress: () => setPurging(menuFor) }]
                  : []),
              ]
            : []
        }
      />
      {purging && <TypedConfirm title={purging.title} onClose={() => setPurging(null)} onConfirm={() => single.mutate({ a: purging, action: 'purge' })} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  menu: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerButton: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  bulkBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
