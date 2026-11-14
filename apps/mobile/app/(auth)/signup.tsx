import {
  ACTIONS,
  type ChallengeResponse,
  checkNewPassword,
  maskEmail,
  MIN_REGISTRATION_AGE,
  registrationSchema,
} from '@signaldesk/domain';
import { Link, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthTabs, CodeStep, issuesByField } from '@/subscriber/AuthParts';
import { useColors } from '@/theme';
import { space } from '@/theme/tokens';
import { AuthFrame, Button, Field, FormError, type InputHandle, T, ToggleRow } from '@/ui';

type Step = 'details' | 'code' | 'password';

function Details({ onSent }: { onSent: (challenge: ChallengeResponse) => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', mobile: '', age: '', consent: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const refs = {
    lastName: useRef<InputHandle>(null),
    email: useRef<InputHandle>(null),
    mobile: useRef<InputHandle>(null),
    age: useRef<InputHandle>(null),
  };
  // Editing a field clears its message: it was about the old value.
  const set = (key: keyof typeof form) => (value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      const { [key]: _cleared, ...rest } = e;
      return rest;
    });
  };
  const submit = async () => {
    const body = { ...form, age: form.age.trim() === '' ? undefined : Number(form.age) };
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      onSent(await api.post<ChallengeResponse>('/auth/register', body));
    } catch (caught) {
      setErrors(issuesByField(caught));
      setError(caught);
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field
            testID="signup-first"
            label="First name"
            value={form.firstName}
            onChangeText={set('firstName')}
            error={errors.firstName}
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
            onSubmitEditing={() => refs.lastName.current?.focus()}
            submitBehavior="submit"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            testID="signup-last"
            ref={refs.lastName}
            label="Last name"
            value={form.lastName}
            onChangeText={set('lastName')}
            error={errors.lastName}
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="next"
            onSubmitEditing={() => refs.email.current?.focus()}
            submitBehavior="submit"
          />
        </View>
      </View>
      <Field
        testID="signup-email"
        ref={refs.email}
        label="Email address"
        value={form.email}
        onChangeText={set('email')}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => refs.mobile.current?.focus()}
        submitBehavior="submit"
      />
      <Field
        testID="signup-mobile"
        ref={refs.mobile}
        label="Mobile number"
        value={form.mobile}
        onChangeText={set('mobile')}
        error={errors.mobile}
        hint="Without a country code, +91 is used."
        placeholder="+91 98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="next"
        onSubmitEditing={() => refs.age.current?.focus()}
        submitBehavior="submit"
      />
      <Field
        testID="signup-age"
        ref={refs.age}
        label="Age"
        value={form.age}
        onChangeText={(v) => set('age')(v.replace(/\D/g, '').slice(0, 3))}
        error={errors.age}
        keyboardType="number-pad"
        maxLength={3}
        returnKeyType="done"
      />
      <ToggleRow
        testID="signup-consent"
        label={`I am ${MIN_REGISTRATION_AGE} or older and accept the privacy notice`}
        value={form.consent}
        onChange={(v) => set('consent')(v)}
      />
      {errors.consent ? (
        <T v="small" c="stop">
          {errors.consent}
        </T>
      ) : null}
      <FormError error={Object.keys(errors).length > 0 ? null : error} />
      <Button
        testID="signup-submit"
        label={ACTIONS.createAccount}
        variant="primary"
        large
        full
        loading={busy}
        onPress={() => void submit()}
      />
      <Link href="/disclosures" asChild>
        <Pressable accessibilityRole="link" hitSlop={10} style={{ alignSelf: 'center' }}>
          <T v="small" c="muted" style={{ textDecorationLine: 'underline' }}>
            Privacy notice
          </T>
        </Pressable>
      </Link>
    </View>
  );
}

function Password({ setupToken }: { setupToken: string }) {
  const c = useColors();
  const router = useRouter();
  const { completeSignUp } = useSession();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const check = checkNewPassword(password, confirm);
  const submit = async () => {
    if (!check.ok) {
      setError(new Error(password.length < 10 ? 'Use at least 10 characters.' : 'The passwords do not match.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeSignUp(setupToken, password);
      router.replace('/welcome');
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <Field
        testID="signup-password"
        label="Create password"
        value={password}
        onChangeText={setPassword}
        secret
        autoComplete="new-password"
        textContentType="newPassword"
        autoFocus
      />
      <Field
        testID="signup-confirm"
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secret
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
        {check.hints.map((hint) => (
          <T key={hint.text} v="small" style={{ color: hint.met ? c.success : c.subtle }}>
            {hint.met ? '✓ ' : '• '}
            {hint.text}
          </T>
        ))}
      </View>
      <FormError error={error} />
      <Button
        testID="signup-create-password"
        label={ACTIONS.createPassword}
        variant="primary"
        large
        full
        loading={busy}
        onPress={() => void submit()}
      />
    </View>
  );
}

export default function SignUp() {
  const [step, setStep] = useState<Step>('details');
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const title =
    step === 'details' ? 'Create your account' : step === 'code' ? ACTIONS.verifyEmail : ACTIONS.createPassword;
  const description =
    step === 'code' && challenge ? `Enter the code we sent to ${maskEmail(challenge.email)}.` : undefined;
  return (
    <AuthFrame title={title} description={description}>
      {step === 'details' && <AuthTabs current="signup" />}
      {step === 'details' && (
        <Details
          onSent={(c) => {
            setChallenge(c);
            setStep('code');
          }}
        />
      )}
      {step === 'code' && challenge && (
        <>
          <CodeStep
            challenge={challenge}
            resendPath="/auth/register/resend"
            verifyPath="/auth/register/verify"
            onChallenge={setChallenge}
            onVerified={(result) => {
              setSetupToken((result as { setupToken: string }).setupToken);
              setStep('password');
            }}
          />
          <Button
            small
            variant="ghost"
            label="Change email"
            onPress={() => setStep('details')}
            style={{ alignSelf: 'flex-start' }}
          />
        </>
      )}
      {step === 'password' && setupToken && <Password setupToken={setupToken} />}
    </AuthFrame>
  );
}
