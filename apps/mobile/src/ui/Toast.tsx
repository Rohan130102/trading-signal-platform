import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import type { IconName } from './Button';
import { T } from './Text';

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: 'success' | 'error' | 'info' | 'warning' | 'buy' | 'sell';
  onPress?: () => void;
  /** One extra choice, such as Undo. It closes the banner. */
  action?: { label: string; onPress: () => void };
  duration: number;
}

type Show = (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void;

const ToastContext = createContext<Show | null>(null);

export function useToast(): Show {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);
  const show = useCallback<Show>((next) => {
    counter.current += 1;
    setToast({ duration: 4000, ...next, id: counter.current });
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && <ToastView key={toast.id} toast={toast} onDone={() => setToast(null)} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const finished = useRef(onDone);
  finished.current = onDone;

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220 }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => finished.current());
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [anim, toast.duration]);

  const look: Record<Toast['tone'], { color: string; icon: IconName }> = {
    success: { color: c.success, icon: 'checkmark-circle' },
    error: { color: c.stop, icon: 'alert-circle' },
    info: { color: c.muted, icon: 'information-circle' },
    warning: { color: c.update, icon: 'warning' },
    buy: { color: c.buy, icon: 'trending-up' },
    sell: { color: c.sell, icon: 'trending-down' },
  };
  const { color, icon } = look[toast.tone];
  return (
    <Animated.View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        {
          top: insets.top + space.sm,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
        },
      ]}
    >
      <Pressable
        testID="toast"
        accessibilityRole={toast.onPress ? 'button' : 'alert'}
        onPress={() => {
          toast.onPress?.();
          onDone();
        }}
        style={[styles.toast, { backgroundColor: c.raised, borderColor: c.lineStrong }]}
      >
        <View style={[styles.accent, { backgroundColor: color }]} />
        <Ionicons name={icon} size={20} color={color} />
        <View style={styles.text}>
          <T v="strong" numberOfLines={2}>
            {toast.title}
          </T>
          {toast.body && (
            <T v="small" c="muted" numberOfLines={2}>
              {toast.body}
            </T>
          )}
        </View>
        {toast.action && (
          <Pressable
            testID="toast-action"
            accessibilityRole="button"
            accessibilityLabel={toast.action.label}
            onPress={() => {
              toast.action?.onPress();
              onDone();
            }}
            hitSlop={6}
            style={({ pressed }) => [styles.action, { borderColor: c.lineStrong, opacity: pressed ? 0.7 : 1 }]}
          >
            <T v="strong">{toast.action.label}</T>
          </Pressable>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 100, elevation: 100 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingRight: space.lg,
    paddingLeft: space.lg + 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  text: { flex: 1, minWidth: 0 },
  action: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
