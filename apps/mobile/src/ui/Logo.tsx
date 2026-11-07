import Svg, { Path, Rect } from 'react-native-svg';
import { useColors } from '@/theme';

/** The same rising line as the app icon. */
export function Logo({ size = 44 }: { size?: number }) {
  const c = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityRole="image" accessibilityLabel="SignalDesk">
      <Rect width={100} height={100} rx={24} fill={c.raised} />
      <Path
        d="M20 68 L41 47 L55 59 L80 32 M62 32 L80 32 L80 50"
        fill="none"
        stroke={c.buy}
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
