import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '@/theme/tokens';
import { Logo } from './Logo';
import { Screen } from './Screen';
import { T } from './Text';

export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Screen edges={['top', 'bottom']} keyboard style={styles.page}>
      <Logo size={48} />
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
  page: { paddingTop: space.xxl, gap: space.lg, flexGrow: 1 },
  titles: { gap: space.sm },
});
