import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputInstance, type TextInputProps, View } from 'react-native';
import { useColors } from '@/theme';
import { radius, space, TOUCH } from '@/theme/tokens';
import { T } from './Text';

export interface FieldProps extends TextInputProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  num?: boolean;
  big?: boolean;
  secret?: boolean;
}

export type InputHandle = TextInputInstance;

export const Field = forwardRef<InputHandle, FieldProps>(function Field(
  { label, hint, error, num, big, secret, style, onFocus, onBlur, ...rest },
  ref,
) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <T v="small" c="muted" style={{ fontWeight: '500' }}>
        {label}
      </T>
      <View>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={typeof hint === 'string' ? hint : undefined}
          placeholderTextColor={c.subtle}
          selectionColor={c.buy}
          secureTextEntry={secret && !revealed}
          maxFontSizeMultiplier={1.4}
          keyboardAppearance={c.scheme}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
          style={[
            styles.input,
            {
              color: c.text,
              backgroundColor: c.raised,
              borderColor: error ? c.stop : focused ? c.lineStrong : c.line,
              fontSize: big ? 22 : 16,
              fontWeight: big ? '700' : num ? '600' : '400',
              minHeight: big ? 58 : TOUCH + 2,
              paddingRight: secret ? 52 : space.md,
            },
            (num || big) && { fontVariant: ['tabular-nums'] },
            rest.multiline && { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },
            style,
          ]}
        />
        {secret && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((v) => !v)}
            style={styles.reveal}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.muted} />
          </Pressable>
        )}
      </View>
      {error ? (
        <T v="small" c="stop" accessibilityLiveRegion="polite">
          {error}
        </T>
      ) : hint ? (
        <T v="caption" c="subtle">
          {hint}
        </T>
      ) : null}
    </View>
  );
});

/** Some phones offer a decimal comma. Prices always travel with a point. */
export const cleanPrice = (value: string): string => value.replace(/,/g, '.').replace(/[^\d.]/g, '');

export const PriceField = forwardRef<
  InputHandle,
  Omit<FieldProps, 'onChangeText' | 'value' | 'onChange'> & { value: string; onChange: (value: string) => void }
>(function PriceField({ value, onChange, ...rest }, ref) {
  return (
    <Field
      ref={ref}
      num
      keyboardType="decimal-pad"
      autoComplete="off"
      autoCorrect={false}
      value={value}
      onChangeText={(next) => onChange(cleanPrice(next))}
      {...rest}
    />
  );
});

const styles = StyleSheet.create({
  field: { gap: 6, flexShrink: 1 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  reveal: {
    position: 'absolute',
    right: 2,
    top: 1,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
