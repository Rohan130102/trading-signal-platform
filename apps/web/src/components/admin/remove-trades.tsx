'use client';

import { REMOVE_CONFIRMATION, TERMINAL_STATUSES, type TradeStatus } from '@signaldesk/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EyeOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Field, FormError, Input, Textarea } from '@/components/ui';
import { api } from '@/lib/api';

export interface RemovableTrade {
  id: string;
  ref: string;
  symbol: string;
  status: TradeStatus;
  removedAt?: string | null;
}

export const canRemove = (t: RemovableTrade) => TERMINAL_STATUSES.includes(t.status) && !t.removedAt;

/**
 * The Master Admin taking finished trades off every subscriber screen. Asks for a reason and the typed word,
 * and says plainly what happens and what does not.
 */
export function RemoveTradesDialog({
  trades,
  onClose,
  onDone,
}: {
  trades: RemovableTrade[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const remove = useMutation({
    mutationFn: () =>
      api.post<{ removed: number }>('/admin/trade-removals', {
        tradeIds: trades.map((t) => t.id),
        expectedCount: trades.length,
        reason: reason.trim(),
        confirm: typed.trim(),
      }),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      toast.success(`${r.removed} removed from subscriber screens`);
      onDone?.();
      onClose();
    },
  });
  const ready = reason.trim().length >= 5 && typed.trim() === REMOVE_CONFIRMATION;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Remove ${trades.length === 1 ? 'this trade' : `${trades.length} trades`} from subscriber screens?`}
      description={trades.map((t) => `${t.ref} ${t.symbol}`).join(', ')}
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1.5 text-[13px] text-muted">
          <li>
            Subscribers stop seeing it everywhere: Signals, History, Alerts and the trade page, on the web and in the
            app.
          </li>
          <li>Nothing is deleted. Administrators still see it, marked removed, and you can put it back.</li>
          <li className="font-medium text-text">
            Performance figures keep counting it, so removing a losing trade never improves the results.
          </li>
          <li>Your name, the reason and the trade’s outcome are written to the audit log.</li>
        </ul>
        <Field label="Reason" required hint="At least 5 characters. Kept in the audit log.">
          {(c) => (
            <Textarea
              {...c}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Published by mistake during setup"
            />
          )}
        </Field>
        <Field label={`Type ${REMOVE_CONFIRMATION} to confirm`} required>
          {(c) => (
            <Input
              {...c}
              autoCapitalize="characters"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          )}
        </Field>
        <FormError error={remove.error} />
        <div className="flex gap-2">
          <Button variant="danger" disabled={!ready} loading={remove.isPending} onClick={() => remove.mutate()}>
            <EyeOff className="size-4" aria-hidden /> Remove from screens
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function useRestoreTrades(onDone?: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<{ restored: number }>('/admin/trade-removals/restore', { tradeIds: ids }),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      toast.success(`${r.restored} back on subscriber screens`);
      onDone?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
