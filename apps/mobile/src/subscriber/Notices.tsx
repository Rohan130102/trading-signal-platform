import type { UserNotice } from '@signaldesk/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import { Button, Card, T } from '@/ui';

/** Messages about the person's own account, such as a subscription starting. Shown until dismissed. */
export function Notices() {
  const client = useQueryClient();
  const notices = useQuery({
    queryKey: ['notices'],
    queryFn: () => api.get<{ notices: UserNotice[] }>('/me/notices'),
    staleTime: 30_000,
  });
  const unread = (notices.data?.notices ?? []).filter((n) => !n.read).slice(0, 2);
  if (unread.length === 0) return null;
  const dismiss = async () => {
    await api.post('/me/notices/read').catch(() => undefined);
    void client.invalidateQueries({ queryKey: ['notices'] });
  };
  return (
    <View style={{ gap: space.sm }} testID="notices">
      {unread.map((notice) => (
        <Card key={notice.id} style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="strong">{notice.title}</T>
            <T v="small" c="muted">
              {notice.body}
            </T>
          </View>
          <Button
            small
            variant="ghost"
            label="OK"
            accessibilityLabel="OK, dismiss account messages"
            onPress={() => void dismiss()}
          />
        </Card>
      ))}
    </View>
  );
}
