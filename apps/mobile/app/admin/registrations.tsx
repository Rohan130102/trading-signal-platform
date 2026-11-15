import { ENQUIRY_STATUS_LABELS, formatDateTime, type RegistrationsPage } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AccessBadge } from '@/admin/parts';
import { api, queryString } from '@/lib/api';
import { space } from '@/theme/tokens';
import { Badge, Card, Chip, ChipRow, Divider, EmptyState, ErrorState, Field, ListRow, Loading, Screen, T } from '@/ui';

const FILTERS = [
  { value: '', label: 'Everyone' },
  { value: 'unseen', label: 'New' },
  { value: 'NONE', label: 'No subscription' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'EXPIRED', label: 'Expired' },
] as const;

/** People who signed themselves up, newest first. New ones are marked until an administrator opens them. */
export default function Registrations() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useQuery({
    queryKey: ['admin', 'registrations', q, filter],
    queryFn: () =>
      api.get<RegistrationsPage>(
        `/admin/registrations${queryString({
          q,
          unseen: filter === 'unseen' ? 'true' : undefined,
          access: filter && filter !== 'unseen' ? filter : undefined,
          pageSize: 50,
        })}`,
      ),
    refetchInterval: 30_000,
  });
  const refresh = useCallback(() => list.refetch(), [list]);
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="registrations">
      <Field
        testID="registrations-search"
        label="Search"
        placeholder="Name, email or mobile"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ChipRow>
        {FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} on={filter === f.value} onPress={() => setFilter(f.value)} />
        ))}
      </ChipRow>
      {list.isPending && <Loading rows={3} label="Loading registrations" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.registrations.length === 0 && (
        <EmptyState icon="person-add-outline" title="No registrations match" />
      )}
      {list.data && list.data.registrations.length > 0 && (
        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          {list.data.registrations.map((r, i) => (
            <View key={r.id}>
              {i > 0 && <Divider />}
              <ListRow
                testID={`registration-${r.id}`}
                title={r.name}
                subtitle={[
                  r.email,
                  r.mobile,
                  r.age ? `Age ${r.age}` : null,
                  ENQUIRY_STATUS_LABELS[r.enquiryStatus],
                  formatDateTime(r.registeredAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {r.isNew && <Badge tone="buy">New</Badge>}
                    <AccessBadge row={{ status: 'ACTIVE', subscription: r.subscription }} />
                  </View>
                }
                onPress={() => router.push(`/admin/subscribers/${r.id}`)}
              />
            </View>
          ))}
        </Card>
      )}
      {list.data && <T v="caption" c="subtle">{`${list.data.unseen} new · ${list.data.total} shown`}</T>}
    </Screen>
  );
}
