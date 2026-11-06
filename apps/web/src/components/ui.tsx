'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { ApiError } from '@/lib/api';
import { buttonClass, type ButtonVariant } from './styles';

export { buttonClass };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

const controlClass =
  'w-full h-10 max-md:h-11 rounded-lg bg-bg border border-line-strong px-3 text-sm text-text placeholder:text-subtle transition-colors hover:border-subtle focus:outline-2 focus:outline-text focus:outline-offset-1 disabled:opacity-60 aria-invalid:border-stop';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={clsx(controlClass, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea ref={ref} className={clsx(controlClass, 'h-auto min-h-20 py-2 leading-relaxed', className)} {...props} />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={clsx(controlClass, 'pr-8', className)} {...props} />;
});

interface FieldProps {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  /** Receives the wiring for the control: id plus accessible description and error state. */
  children: (control: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-muted">
        {label}
        {required && <span className="text-subtle"> (required)</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-subtle leading-relaxed">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-[13px] text-stop" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  className?: string;
  activeClassName?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
}: {
  value: T | null;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const name = useId();
  return (
    <fieldset
      className={clsx('grid gap-1 p-1 rounded-xl bg-bg border border-line', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <label
            key={option.value}
            className={clsx(
              'relative flex items-center justify-center gap-1.5 rounded-lg px-3 cursor-pointer select-none text-sm font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-text',
              size === 'lg' ? 'h-12 text-[15px]' : 'h-9 max-md:h-11',
              active ? (option.activeClassName ?? 'bg-raised text-text') : 'text-muted hover:text-text',
              option.className,
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              checked={active}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-2.5 text-left disabled:opacity-50 min-h-11"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-[13px] text-muted">{description}</span>}
      </span>
      <span
        aria-hidden
        className={clsx(
          'relative h-6 w-10 shrink-0 rounded-full transition-colors border',
          checked ? 'bg-primary border-primary' : 'bg-bg border-line-strong',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 size-[18px] rounded-full transition-[left,background-color]',
            checked ? 'left-[18px] bg-primary-text' : 'left-0.5 bg-subtle',
          )}
        />
      </span>
    </button>
  );
}

export function Card({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className={clsx('rounded-xl border border-line bg-surface', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  action,
  description,
}: {
  title: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = 'buy' | 'sell' | 'update' | 'success' | 'stop' | 'neutral';

const TONES: Record<Tone, string> = {
  buy: 'bg-buy-soft text-buy',
  sell: 'bg-sell-soft text-sell',
  update: 'bg-update-soft text-update',
  success: 'bg-success-soft text-success',
  stop: 'bg-stop-soft text-stop',
  neutral: 'bg-neutral-soft text-muted',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 animate-overlay" />
        <RadixDialog.Content
          aria-describedby={description ? undefined : undefined}
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line-strong bg-surface shadow-float animate-dialog focus:outline-none',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm text-muted">{description}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-2 -mt-1 grid size-11 place-items-center rounded-lg text-muted hover:text-text hover:bg-neutral-soft"
            >
              <X className="size-5" aria-hidden />
            </RadixDialog.Close>
          </div>
          <div className="px-5 pb-5 pt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-xl bg-neutral-soft text-muted">{icon}</div>}
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const message = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
  return (
    <div role="alert">
      <EmptyState
        icon={<AlertTriangle className="size-5" aria-hidden />}
        title={title ?? 'That did not load'}
        action={onRetry && <Button onClick={onRetry}>Try again</Button>}
      >
        {message}
      </EmptyState>
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex gap-2 rounded-lg bg-stop-soft px-3 py-2.5 text-sm text-stop">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-neutral-soft', className)} aria-hidden />;
}

export function Loading({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <div className="mb-1.5">{back}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'success' | 'stop' | 'update';
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd
        className={clsx(
          'mt-0.5 text-[22px] leading-tight font-semibold tracking-tight',
          tone === 'success' && 'text-success',
          tone === 'stop' && 'text-stop',
          tone === 'update' && 'text-update',
        )}
      >
        {value}
      </dd>
      {hint && <dd className="mt-0.5 text-xs text-subtle">{hint}</dd>}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="size-4" aria-hidden /> Previous
      </Button>
      <span className="text-[13px] text-muted">
        Page {page} of {pages}
      </span>
      <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next <ChevronRight className="size-4" aria-hidden />
      </Button>
    </nav>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="hidden rounded border border-current/30 px-1 font-mono text-[11px] md:inline">{children}</kbd>;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
      <path
        d="M6 15.5 10.2 11l3 3L18 8.5"
        stroke="var(--bg)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
