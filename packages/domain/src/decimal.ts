import { Decimal } from 'decimal.js';

/** A price or quantity on the wire and in JSON. Never a JS number. */
export type DecimalString = string;

/** Isolated clone: financial maths must not depend on global Decimal configuration. */
export const Dec = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Dec = InstanceType<typeof Dec>;

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Parses a plain decimal literal. Rejects exponents, "NaN", "Infinity" and empty input. */
export function toDec(value: DecimalString | Dec): Dec {
  if (value instanceof Dec) return value;
  if (typeof value !== 'string' || !PLAIN_NUMBER.test(value.trim())) {
    throw new RangeError(`Not a decimal literal: ${String(value)}`);
  }
  return new Dec(value.trim());
}

export function isDecimalLiteral(value: unknown): value is string {
  return typeof value === 'string' && PLAIN_NUMBER.test(value.trim());
}

/** Canonical storage form: no exponent, no trailing zeros. */
export function canon(value: Dec | DecimalString): DecimalString {
  return toDec(value).toFixed();
}

export function decimalPlaces(value: DecimalString): number {
  return toDec(value).decimalPlaces();
}

export function decimalEquals(a: DecimalString, b: DecimalString): boolean {
  return toDec(a).equals(toDec(b));
}

/** Half-even display rounding with a fixed number of decimals. Display only: never feed it back. */
export function toFixedDisplay(value: DecimalString | Dec, decimals: number): string {
  return toDec(value).toFixed(decimals, Dec.ROUND_HALF_EVEN);
}

/** Adds thousands separators to a plain decimal string, preserving its decimals. */
export function groupThousands(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction] = (negative ? value.slice(1) : value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction !== undefined ? `.${fraction}` : ''}`;
}
