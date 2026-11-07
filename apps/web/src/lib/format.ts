export {
  formatClock,
  formatDateTime,
  formatFull,
  formatLocalDate,
  formatRelative,
  money,
  percent,
  signedPoints,
} from '@signaldesk/domain';

export function newKey(): string {
  return crypto.randomUUID();
}
