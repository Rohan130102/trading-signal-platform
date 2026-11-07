import { DarkTheme, DefaultTheme, type Theme } from 'expo-router/react-navigation';
import * as SystemUI from 'expo-system-ui';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { prefs } from '@/lib/storage';
import { dark, light, type Palette } from './tokens';

export type ThemeChoice = 'dark' | 'light' | 'system';

interface ThemeValue {
  colors: Palette;
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
  navigation: Theme;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

export function useColors(): Palette {
  return useTheme().colors;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  // Dark by default: this is read at the desk and at night.
  const [choice, setChoiceState] = useState<ThemeChoice>('dark');

  useEffect(() => {
    void prefs.get<ThemeChoice>('theme').then((saved) => {
      if (saved === 'dark' || saved === 'light' || saved === 'system') setChoiceState(saved);
    });
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    void prefs.set('theme', next);
  }, []);

  const colors = choice === 'system' ? (system === 'light' ? light : dark) : choice === 'light' ? light : dark;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);
  }, [colors.bg]);

  const navigation = useMemo<Theme>(() => {
    const base = colors.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.text,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.line,
        notification: colors.stop,
      },
    };
  }, [colors]);

  const value = useMemo<ThemeValue>(
    () => ({ colors, choice, setChoice, navigation }),
    [choice, colors, navigation, setChoice],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
