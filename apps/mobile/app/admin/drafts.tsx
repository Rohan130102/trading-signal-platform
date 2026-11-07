import { type DraftRow, formatRelative } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, View } from 'react-native';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import { Button, Card, EmptyState, ErrorState, errorMessage, Loading, ModalFrame, Screen, T, useToast } from '@/ui';

function Drafts() {
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const drafts = useQuery({
    queryKey: ['admin', 'drafts'],
    queryFn: () => api.get<{ drafts: DraftRow[] }>('/admin/drafts'),
  });
  const discard = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/drafts/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin'] }),
    onError: (error) => toast({ title: 'Could not discard', body: errorMessage(error), tone: 'error' }),
  });
  return (
    <Screen edges={['bottom']} testID="drafts">
      {drafts.isPending && <Loading rows={2} label="Loading drafts" />}
      {drafts.isError && <ErrorState error={drafts.error} onRetry={() => void drafts.refetch()} />}
      {drafts.data?.drafts.length === 0 && (
        <EmptyState icon="document-outline" title="No drafts">
          A saved draft is not visible to subscribers until you publish it.
        </EmptyState>
      )}
      {drafts.data?.drafts.map((row) => (
        <Card key={row.id} style={{ gap: space.sm }}>
          <T v="strong">
            {row.draft.direction ?? 'No direction'} · entry {row.draft.entryLow ?? 'not set'}
          </T>
          <T v="caption" c="subtle">
            Saved {formatRelative(row.updatedAt)}
          </T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              style={{ flex: 1 }}
              small
              label="Open"
              variant="primary"
              onPress={() => router.replace({ pathname: '/compose', params: { draft: row.id } })}
            />
            <Button
              style={{ flex: 1 }}
              small
              label="Discard"
              onPress={() =>
                Alert.alert('Discard this draft?', 'This cannot be undone.', [
                  { text: 'Keep', style: 'cancel' },
                  { text: 'Discard', style: 'destructive', onPress: () => discard.mutate(row.id) },
                ])
              }
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

export default function DraftsRoute() {
  return (
    <ModalFrame>
      <Drafts />
    </ModalFrame>
  );
}
