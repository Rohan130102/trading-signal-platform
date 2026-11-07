import { randomUUID } from 'expo-crypto';

/** One key per intent: pressing twice, or retrying after a lost response, applies the action once. */
export const newKey = (): string => randomUUID();
