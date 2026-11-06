import { clsx } from 'clsx';

/** Not a client module, so server components can style links as buttons too. */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-text hover:opacity-90 font-semibold',
  secondary: 'bg-raised text-text border border-line hover:border-line-strong font-medium',
  ghost: 'text-muted hover:text-text hover:bg-neutral-soft font-medium',
  danger: 'bg-stop-soft text-stop border border-stop/30 hover:border-stop/60 font-semibold',
};

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg whitespace-nowrap transition-[opacity,border-color,background-color,color] disabled:opacity-50 disabled:pointer-events-none select-none [&_svg]:shrink-0';

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' | 'lg' = 'md', className?: string) {
  return clsx(
    buttonBase,
    BUTTON_VARIANTS[variant],
    size === 'sm' && 'h-9 px-3 text-[13px] max-md:h-11 max-md:text-sm',
    size === 'md' && 'h-10 px-4 text-sm max-md:h-11',
    size === 'lg' && 'h-12 px-6 text-[15px]',
    className,
  );
}
