import { announcementSchema } from '@signaldesk/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '@/lib/api';
import { newKey } from '@/lib/ids';
import { Button, Field, FormError, Screen, T, ToggleRow, useToast } from '@/ui';

export default function Announcement() {
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState(false);
  const [key] = useState(newKey);
  const [problem, setProblem] = useState<string | undefined>();
  const send = useMutation({
    mutationFn: (body: unknown) => api.post('/admin/announcements', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      toast({ title: 'Announcement sent to subscribers', tone: 'success' });
      router.back();
    },
  });
  const submit = () => {
    const parsed = announcementSchema.safeParse({
      title: title.trim() || undefined,
      message,
      priority: priority ? 'PRIORITY' : 'NORMAL',
      idempotencyKey: key,
    });
    if (!parsed.success) {
      setProblem(parsed.error.flatten().fieldErrors.message?.[0] ?? 'Check the message.');
      return;
    }
    setProblem(undefined);
    send.mutate(parsed.data);
  };
  return (
    <Screen
      edges={['bottom']}
      keyboard
      testID="announcement"
      footer={
        <Button
          testID="announcement-send"
          label="Send to subscribers"
          variant="primary"
          large
          heavy
          loading={send.isPending}
          onPress={submit}
        />
      }
    >
      <T c="muted">Goes to everyone with an active subscription, in the feed and as a notification.</T>
      <Field
        testID="announcement-title"
        label="Title"
        hint="Optional."
        value={title}
        onChangeText={setTitle}
        maxLength={120}
      />
      <Field
        testID="announcement-message"
        label="Message"
        value={message}
        onChangeText={setMessage}
        error={problem}
        multiline
        maxLength={2000}
      />
      <ToggleRow
        label="Priority"
        hint="Louder alert, and highlighted in the feed."
        value={priority}
        onChange={setPriority}
      />
      <FormError error={send.error} />
    </Screen>
  );
}
