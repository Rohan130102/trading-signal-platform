import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type HostInstance, Keyboard, LayoutAnimation, Platform, View, type ViewStyle } from 'react-native';

/**
 * Keeps a screen's content and its bottom button above the keyboard, by measuring how much the keyboard
 * actually covers this view. Whether the system moves anything varies: iOS never does, an installed Android
 * build does not, while Expo Go and Android modals do. Measuring gives the right answer in every case, including
 * zero when the window has already made room, and also under a header or inside a sheet.
 */
export function KeyboardArea({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const view = useRef<HostInstance>(null);
  const keyboardTop = useRef<number | null>(null);
  const [overlap, setOverlap] = useState(0);

  const measure = () => {
    const top = keyboardTop.current;
    if (top === null) {
      setOverlap(0);
      return;
    }
    // The outer frame, so the padding added here does not change the answer.
    view.current?.measureInWindow((_x, y, _width, height) => setOverlap(Math.max(0, y + height - top)));
  };

  useEffect(() => {
    const onShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      (event) => {
        if (Platform.OS === 'ios') {
          LayoutAnimation.configureNext(LayoutAnimation.create(event.duration || 250, 'keyboard'));
        }
        keyboardTop.current = event.endCoordinates.screenY;
        measure();
      },
    );
    const onHide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      setOverlap(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  return (
    <View ref={view} onLayout={measure} style={[style, overlap > 0 && { paddingBottom: overlap }]}>
      {children}
    </View>
  );
}
