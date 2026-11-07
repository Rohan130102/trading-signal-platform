import { createSubscriberSchema, formatLocalDate, type SubscriberRow } from '@signaldesk/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { CredentialsCard } from '@/admin/parts';
import { api } from '@/lib/api';
import { newKey } from '@/lib/ids';
import { space } from '@/theme/tokens';
import { Button, Chip, ChipRow, Field, FormError, ModalFrame, Notice, Screen, T } from '@/ui';

const DURATIONS = [30, 90, 180, 365];

interface Created {
  subscriber: SubscriberRow;
  temporaryPassword: string | null;
}

function NewSubscriber() {
  const router = useRouter();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [loginId, setLoginId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('30');
  const [start, setStart] = useState('');
  const [notes, setNotes] = useState('');
  const [key] = useState(newKey);
  const [problems, setProblems] = useState<Record<string, string | undefined>>({});
  const create = useMutation({
    mutationFn: (body: unknown) => api.post<Created>('/admin/subscribers', body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin'] }),
  });
  const submit = () => {
    const parsed = createSubscriberSchema.safeParse({
      name,
      loginId,
      phone: phone.trim() || null,
      email: email.trim() || null,
      durationDays: Number(days),
      activationDate: start.trim() || undefined,
      notes: notes.trim() || null,
      idempotencyKey: key,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
      setProblems(Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, v?.[0]])));
      return;
    }
    setProblems({});
    create.mutate(parsed.data);
  };
  const result = create.data;
  if (result) {
    const last = result.subscriber.subscription.lastValidDate;
    return (
      <Screen edges={['bottom']} testID="subscriber-created">
        <T v="title">{result.subscriber.name}</T>
        <T c="muted">{last ? `Active through ${formatLocalDate(last)}.` : 'Created.'}</T>
        {result.temporaryPassword ? (
          <CredentialsCard loginId={result.subscriber.loginId} password={result.temporaryPassword} />
        ) : (
          <Notice tone="neutral">
            This account was already created by an earlier attempt. Reset the password from their page to issue a new
            one.
          </Notice>
        )}
        <Button
          testID="subscriber-open"
          label="Open subscriber"
          onPress={() => router.replace(`/admin/subscribers/${result.subscriber.id}`)}
        />
      </Screen>
    );
  }
  return (
    <Screen
      edges={['bottom']}
      keyboard
      testID="subscriber-new"
      footer={
        <Button
          testID="subscriber-create"
          label="Create subscriber"
          variant="primary"
          large
          loading={create.isPending}
          onPress={submit}
        />
      }
    >
      <T c="muted">Record payment outside this app first. It collects nothing.</T>
      <Field
        testID="sub-name"
        label="Name"
        value={name}
        onChangeText={setName}
        error={problems.name}
        autoCapitalize="words"
        autoComplete="off"
      />
      <Field
        testID="sub-login"
        label="Login ID"
        hint="What they sign in with. Their phone number or email works well."
        value={loginId}
        onChangeText={setLoginId}
        error={problems.loginId}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
      />
      <View style={{ gap: space.sm }}>
        <T v="small" c="muted" style={{ fontWeight: '500' }}>
          Duration
        </T>
        <ChipRow>
          {DURATIONS.map((d) => (
            <Chip
              key={d}
              testID={`duration-${d}`}
              label={`${d} days`}
              on={days === String(d)}
              onPress={() => setDays(String(d))}
            />
          ))}
        </ChipRow>
        <Field
          testID="sub-days"
          label="Days"
          hint="Counts calendar days, including the first."
          num
          value={days}
          onChangeText={(v) => setDays(v.replace(/\D/g, ''))}
          error={problems.durationDays}
          keyboardType="number-pad"
        />
      </View>
      <Field
        testID="sub-phone"
        label="Phone"
        hint="Optional."
        value={phone}
        onChangeText={setPhone}
        error={problems.phone}
        keyboardType="phone-pad"
        autoComplete="off"
      />
      <Field
        testID="sub-email"
        label="Email"
        hint="Optional."
        value={email}
        onChangeText={setEmail}
        error={problems.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="off"
      />
      <Field
        testID="sub-start"
        label="Starts on"
        hint="Optional. YYYY-MM-DD. Leave empty to start now."
        num
        value={start}
        onChangeText={setStart}
        error={problems.activationDate}
        keyboardType="numbers-and-punctuation"
        placeholder="2026-12-01"
      />
      <Field
        label="Notes"
        hint="Only administrators see this."
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={2000}
      />
      <FormError error={create.error} />
    </Screen>
  );
}

export default function NewSubscriberRoute() {
  return (
    <ModalFrame>
      <NewSubscriber />
    </ModalFrame>
  );
}
