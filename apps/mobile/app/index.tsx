import { View } from 'react-native';
import { useColors } from '@/theme';

/** The root layout decides where to go. This only holds the screen for that moment. */
export default function Index() {
  const c = useColors();
  return <View style={{ flex: 1, backgroundColor: c.bg }} />;
}
