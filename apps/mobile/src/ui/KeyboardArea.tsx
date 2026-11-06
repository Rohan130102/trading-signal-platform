import { type ReactNode, useEffect, useState } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Keeps a screen's content and its bottom button above the keyboard. Android resizes the window by itself.
 * iOS does not, and the built-in avoiding view measures from its parent, so it comes up short under a
 * header or inside a sheet. Measuring from the bottom of the screen avoids that.
 */
export function KeyboardArea({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { bottom } = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const listener = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      LayoutAnimation.configureNext(LayoutAnimation.create(event.duration || 250, 'keyboard'));
      setKeyboard(Math.max(0, Dimensions.get('screen').height - event.endCoordinates.screenY));
    });
    return () => listener.remove();
  }, []);
  return <View style={[style, keyboard > 0 && { paddingBottom: Math.max(0, keyboard - bottom) }]}>{children}</View>;
}
