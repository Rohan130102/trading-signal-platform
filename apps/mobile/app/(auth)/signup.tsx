import {
  ACTIONS,
  type ChallengeResponse,
  checkNewPassword,
  maskEmail,
  MIN_REGISTRATION_AGE,
  type PublicInfo,
  registrationSchema,
  whatsappDigits,
  whatsappWebLink,
} from '@signaldesk/domain';
import { Link, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { CodeStep, issuesByField } from '@/subscriber/AuthParts';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { AuthFrame, Button, Field, FormError, type InputHandle, T, ToggleRow, usePublicInfo } from '@/ui';

type Step = 'details' | 'code' | 'password' | 'contact';

interface Form {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  age: string;
  consent: boolean;
}

/** What was typed, checked: the mobile number has its country code. */
interface Checked {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  age: number;
}

const EMPTY: Form = { firstName: '', lastName: '', email: '', mobile: '', age: '', consent: false };
const STEP_NAMES = ['Your details', 'Verify email', 'Create password'] as const;
/** Email could not send a code. Nothing is lost: the details go to the team, who set up the account. */
const EMAIL_PROBLEMS = new Set(['EMAIL_NOT_CONFIGURED', 'EMAIL_SEND_FAILED']);

/** How far through sign-up the person is, as a bar and in words. */
function Progress({ step }: { step: 1 | 2 | 3 }) {
  const c = useColors();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
      accessible
      accessibilityLabel={`Step ${step} of 3: ${STEP_NAMES[step - 1]}`}
      testID="signup-progress"
    >
      <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            style={{
              flex: 1,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: n <= step ? c.text : c.lineStrong,
            }}
          />
        ))}
      </View>
      <T v="caption" c="muted" style={{ fontWeight: '600' }}>
        Step {step} of 3
      </T>
    </View>
  );
}

function Details({
  form,
  setForm,
  onSent,
  onEmailProblem,
}: {
  form: Form;
  setForm: (update: (form: Form) => Form) => void;
  onSent: (challenge: ChallengeResponse) => void;
  onEmailProblem: (details: Checked) => void;
}) {
  const router = useRouter();
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
  const set = (key: keyof Form) => (value: string | boolean) => {
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
      setBusy(false);
      if (caught instanceof ApiError && EMAIL_PROBLEMS.has(caught.code)) {
        const { consent: _consent, ...details } = parsed.data;
        onEmailProblem(details);
        return;
      }
      setErrors(issuesByField(caught));
      setError(caught);
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
        hint="We send a code to this address to confirm it."
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
        hint="Your WhatsApp number if you have one. Without a country code, +91 is used."
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
      <Link href="/disclosures" asChild>
        <Pressable accessibilityRole="link" hitSlop={10} style={{ alignSelf: 'flex-start' }}>
          <T v="small" c="muted" style={{ textDecorationLine: 'underline' }}>
            Read the privacy notice
          </T>
        </Pressable>
      </Link>
      <Button
        testID="signup-submit"
        label="Continue"
        variant="primary"
        large
        full
        loading={busy}
        onPress={() => void submit()}
      />
      <Pressable
        accessibilityRole="link"
        hitSlop={10}
        style={{ alignSelf: 'center' }}
        testID="signup-login"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      >
        <T v="small" c="muted">
          Already have an account?{' '}
          <T v="small" style={{ fontWeight: '700' }}>
            {ACTIONS.logIn}
          </T>
        </T>
      </Pressable>
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
        label={ACTIONS.createAccount}
        variant="primary"
        large
        full
        loading={busy}
        onPress={() => void submit()}
      />
    </View>
  );
}

/**
 * When no code could be emailed. The person's details are not lost: one tap sends them to the team on WhatsApp,
 * or by email when there is no WhatsApp number, and the team sets up the account.
 */
function Contact({ details, info, onBack }: { details: Checked; info: PublicInfo | undefined; onBack: () => void }) {
  const c = useColors();
  const message = [
    `Hello, I would like to create a ${info?.serviceName ?? 'SignalDesk'} account.`,
    `Name: ${details.firstName} ${details.lastName}`,
    `Email: ${details.email}`,
    `Mobile: ${details.mobile}`,
    `Age: ${details.age}`,
  ].join('\n');
  const whatsapp = whatsappWebLink(info?.supportWhatsapp ?? '', message);
  const email = info?.supportEmail
    ? `mailto:${info.supportEmail}?subject=${encodeURIComponent(`New account: ${details.firstName} ${details.lastName}`)}&body=${encodeURIComponent(message)}`
    : null;
  const rows: [string, string][] = [
    ['Name', `${details.firstName} ${details.lastName}`],
    ['Email', details.email],
    ['Mobile', details.mobile],
  ];
  return (
    <View style={{ gap: space.md }} testID="signup-contact">
      <View
        style={{
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: c.line,
          backgroundColor: c.bg,
          padding: space.md,
          gap: 6,
        }}
      >
        {rows.map(([label, value]) => (
          <View key={label} style={{ flexDirection: 'row', gap: space.md }}>
            <T v="small" c="muted" style={{ width: 56 }}>
              {label}
            </T>
            <T v="small" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
              {value}
            </T>
          </View>
        ))}
      </View>
      {whatsapp ? (
        <Button
          testID="signup-whatsapp"
          icon="logo-whatsapp"
          label="Send my details on WhatsApp"
          variant="primary"
          large
          full
          onPress={() => void Linking.openURL(whatsapp)}
        />
      ) : null}
      {email ? (
        <Button
          testID="signup-email"
          icon="mail-outline"
          label={whatsapp ? 'Email them instead' : 'Email my details'}
          variant={whatsapp ? undefined : 'primary'}
          large
          full
          onPress={() => void Linking.openURL(email)}
        />
      ) : null}
      {!whatsapp && !email ? <T c="muted">Please try again later. Your details have not been sent anywhere.</T> : null}
      <Button testID="signup-retry" variant="ghost" label="Try again" full onPress={onBack} />
    </View>
  );
}

/** Shown instead of the form only while the Super Admin has paused sign-up, with a way to reach the team. */
function SignupPaused({ info }: { info: PublicInfo }) {
  const digits = whatsappDigits(info.supportWhatsapp);
  return (
    <AuthFrame
      title="Sign-up is paused"
      description="New accounts cannot be created at the moment. Message our team and they will help you join."
    >
      <View style={{ gap: space.md }} testID="signup-unavailable">
        {digits ? (
          <Button
            testID="signup-whatsapp"
            icon="logo-whatsapp"
            label="Message us on WhatsApp"
            variant="primary"
            large
            full
            onPress={() => void Linking.openURL(`https://wa.me/${digits}`)}
          />
        ) : null}
        {info.supportEmail ? (
          <Button
            testID="signup-email"
            icon="mail-outline"
            label={`Email ${info.supportEmail}`}
            variant={digits ? undefined : 'primary'}
            large
            full
            onPress={() => void Linking.openURL(`mailto:${info.supportEmail}`)}
          />
        ) : null}
      </View>
    </AuthFrame>
  );
}

export default function SignUp() {
  const info = usePublicInfo();
  const [step, setStep] = useState<Step>('details');
  // Kept here, so going back from a later step shows what was typed.
  const [form, setForm] = useState<Form>(EMPTY);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);

  if (step === 'details' && info.data && !info.data.signupOpen) return <SignupPaused info={info.data} />;
  if (step === 'contact' && checked) {
    return (
      <AuthFrame
        title="We could not send your code"
        description="Email codes are not working on our side right now. Send your details to our team and they will set up your account."
      >
        <Contact details={checked} info={info.data} onBack={() => setStep('details')} />
      </AuthFrame>
    );
  }
  const n = step === 'details' ? 1 : step === 'code' ? 2 : 3;
  const title =
    step === 'details' ? 'Create your account' : step === 'code' ? ACTIONS.verifyEmail : ACTIONS.createPassword;
  const description =
    step === 'details'
      ? 'It takes a minute. You get signals once your subscription or trial starts.'
      : step === 'code' && challenge
        ? `Enter the 6-digit code we sent to ${maskEmail(challenge.email)}.`
        : 'You will use it with your email address to log in.';
  return (
    <AuthFrame title={title} description={description} eyebrow={<Progress step={n} />}>
      {step === 'details' && (
        <Details
          form={form}
          setForm={setForm}
          onSent={(c) => {
            setChallenge(c);
            setStep('code');
          }}
          onEmailProblem={(details) => {
            setChecked(details);
            setStep('contact');
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
