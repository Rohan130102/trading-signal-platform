import type { PublicInfo } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import { Logo } from './Logo';
import { Screen } from './Screen';
import { T } from './Text';

/**
 * Log in, sign up, recovery and the status screens: the service's name at the top, then one clear title and the
 * form. Nothing else competes for attention.
 */
export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const info = useQuery({
    queryKey: ['public-info'],
    queryFn: () => api.get<PublicInfo>('/public/info'),
    staleTime: 60_000,
  });
  return (
    <Screen edges={['top', 'bottom']} keyboard style={styles.page}>
      <View style={styles.brand}>
        <Logo size={40} />
        <T v="heading" numberOfLines={1} style={styles.name}>
          {info.data?.serviceName ?? 'SignalDesk'}
        </T>
      </View>
      <View style={styles.titles}>
        <T v="display" accessibilityRole="header">
          {title}
        </T>
        {description && <T c="muted">{description}</T>}
      </View>
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: space.xl, gap: space.lg, flexGrow: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  name: { flexShrink: 1 },
  titles: { gap: space.sm },
});
