import { Text, type TextProps, type TextStyle } from 'react-native';
import { useColors } from '@/theme';
import type { Palette } from '@/theme/tokens';

const VARIANTS = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  strong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.4 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  price: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  bigPrice: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
} as const satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof VARIANTS;
type ColorName = Extract<
  keyof Palette,
  'text' | 'muted' | 'subtle' | 'buy' | 'sell' | 'update' | 'success' | 'stop' | 'primaryText' | 'bg'
>;

export interface TProps extends TextProps {
  v?: TextVariant;
  c?: ColorName;
  /** Tabular figures, so prices line up and do not jitter as they change. */
  num?: boolean;
  strike?: boolean;
  center?: boolean;
}

export function T({ v = 'body', c = 'text', num, strike, center, style, ...rest }: TProps) {
  const colors = useColors();
  const isNumber = num || v === 'price' || v === 'bigPrice';
  return (
    <Text
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        VARIANTS[v],
        { color: colors[c] },
        isNumber && { fontVariant: ['tabular-nums'] },
        strike && { textDecorationLine: 'line-through' },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}
