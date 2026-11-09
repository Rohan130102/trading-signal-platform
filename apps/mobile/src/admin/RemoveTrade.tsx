import { REMOVE_CONFIRMATION } from '@signaldesk/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { space } from '@/theme/tokens';
import { Button, Field, FormError, Notice, Sheet, T, useToast } from '@/ui';

/**
 * The Master Admin taking a finished trade off every subscriber screen. A reason and the typed word are needed,
 * and the sheet says plainly what changes and what does not.
 */
export function RemoveTradeSheet({
  trade,
  onClose,
}: {
  trade: { id: string; ref: string; symbol: string };
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const remove = useMutation({
    mutationFn: () =>
      api.post<{ removed: number }>('/admin/trade-removals', {
        tradeIds: [trade.id],
        expectedCount: 1,
        reason: reason.trim(),
        confirm: typed.trim(),
      }),
    onSuccess: () => {
      haptics.notify('success');
      void client.invalidateQueries({ queryKey: ['admin'] });
      toast({ tone: 'success', title: `${trade.ref} removed from subscriber screens` });
      onClose();
    },
  });
  const ready = reason.trim().length >= 5 && typed.trim() === REMOVE_CONFIRMATION;
  return (
    <Sheet
      testID="remove-trade"
      title="Remove from subscriber screens?"
      subtitle={`${trade.ref} · ${trade.symbol}`}
      onClose={onClose}
      footer={
        <View style={{ gap: space.sm }}>
          <FormError error={remove.error} />
          <Button
            testID="remove-confirm"
            label="Remove from screens"
            variant="danger"
            large
            heavy
            disabled={!ready}
            loading={remove.isPending}
            onPress={() => remove.mutate()}
          />
        </View>
      }
    >
      <T c="muted">
        Subscribers stop seeing it everywhere: Signals, History, Alerts and the trade page, in the app and on the web.
      </T>
      <Notice tone="neutral" icon="stats-chart-outline" title="Still counted in performance">
        Nothing is deleted. Administrators still see it, you can put it back, and every performance figure keeps
        counting it, so removing a losing trade never improves the results.
      </Notice>
      <Field
        testID="remove-reason"
        label="Reason"
        hint="At least 5 characters. Kept in the audit log with your name and the trade's outcome."
        value={reason}
        onChangeText={setReason}
        multiline
      />
      <Field
        testID="remove-typed"
        label={`Type ${REMOVE_CONFIRMATION} to confirm`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
      />
    </Sheet>
  );
}
