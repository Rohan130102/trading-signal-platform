'use client';

import { ACTIONS, OTP_LENGTH, OTP_RESEND_SECONDS } from '@signaldesk/domain';
import { clsx } from 'clsx';
import { Check, Eye, EyeOff } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type RefObject, useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';

/**
 * What a form's named fields hold right now, as the browser sees them. On a slow connection people type, and password
 * managers fill in, before the page's scripts have run; that text is in the fields but not yet in React's state.
 */
export function readFields(form: HTMLFormElement | null): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  if (!form) return values;
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement) || !element.name) continue;
    values[element.name] = element.type === 'checkbox' ? element.checked : element.value;
  }
  return values;
}

/**
 * Puts the cursor in this field once the page is interactive, unless the person is already in another one. On a page
 * rendered by the server, `autoFocus` becomes the browser's own `autofocus` attribute, which Safari can apply after
 * someone has started typing in another field: the rest of their password then lands at the start of the first one.
 */
export function useFocusOnLoad<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus();
  }, []);
  return ref;
}

/** Once the page is interactive, takes in anything typed or filled in before it was, so nothing is lost. */
export function useEarlyInput(
  form: RefObject<HTMLFormElement | null>,
  apply: (values: Record<string, string | boolean>) => void,
) {
  useEffect(() => {
    const values = Object.fromEntries(
      Object.entries(readFields(form.current)).filter(([, v]) => v !== '' && v !== false),
    );
    if (Object.keys(values).length > 0) apply(values);
    // Only once, when the page becomes interactive. Later typing arrives through the fields' own events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput(props, ref) {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <Input {...props} ref={ref} type={show ? 'text' : 'password'} className="pr-12" />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute right-0 top-0 grid h-full w-11 place-items-center text-muted hover:text-text"
        >
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    );
  },
);

/** One field for the whole code, so paste and the phone's one-time-code suggestion both work. */
export const CodeInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { value: string }>(
  function CodeInput({ value, onChange, ...props }, ref) {
    return (
      <Input
        {...props}
        ref={ref}
        value={value}
        onChange={(e) => {
          e.target.value = e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
          onChange?.(e);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        pattern="[0-9]*"
        placeholder={'•'.repeat(OTP_LENGTH)}
        className="num h-12 text-center text-xl tracking-[0.5em] placeholder:tracking-[0.5em]"
      />
    );
  },
);

/** Counts down to when a new code may be asked for; the server enforces the same wait. */
export function ResendButton({ onResend }: { onResend: () => Promise<void> }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Counted from when this code arrived (the parent remounts this for each code), so a device whose clock is off
  // still shows the right wait. The server enforces the same wait in any case.
  const [arrivedAt] = useState(() => Date.now());
  const wait = Math.max(0, Math.ceil(OTP_RESEND_SECONDS - (now - arrivedAt) / 1000));
  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0"
      disabled={wait > 0}
      loading={busy}
      onClick={() => {
        setBusy(true);
        void onResend().finally(() => setBusy(false));
      }}
    >
      {wait > 0 ? `${ACTIONS.resendCode} in ${wait}s` : ACTIONS.resendCode}
    </Button>
  );
}

export function Hints({ hints }: { hints: { text: string; met: boolean }[] }) {
  return (
    <ul className="flex flex-col gap-1 text-[13px]" aria-live="polite">
      {hints.map((hint) => (
        <li key={hint.text} className={clsx('flex items-center gap-2', hint.met ? 'text-success' : 'text-subtle')}>
          <Check className={clsx('size-3.5', hint.met ? 'opacity-100' : 'opacity-30')} aria-hidden />
          {hint.text}
          <span className="sr-only">{hint.met ? '(done)' : '(not yet)'}</span>
        </li>
      ))}
    </ul>
  );
}

/** Field messages from the server's validation, keyed by field name. */
export function issuesByField(error: unknown): Record<string, string> {
  const issues = (error as { details?: { issues?: { field: string; message: string }[] } } | null)?.details?.issues;
  const out: Record<string, string> = {};
  for (const issue of issues ?? []) out[issue.field.split('.')[0] as string] ??= issue.message;
  return out;
}
