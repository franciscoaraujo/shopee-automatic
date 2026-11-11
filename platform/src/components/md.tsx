// Componentes Material Design 3 (implementados com Tailwind).
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'inverse';

const base =
  'state-layer inline-flex items-center justify-center gap-2 rounded-full text-label-l whitespace-nowrap select-none ' +
  'transition-shadow duration-200 disabled:pointer-events-none disabled:opacity-40';

const variants: Record<Variant, string> = {
  filled: 'bg-primary text-on-primary hover:shadow-e1',
  tonal: 'bg-secondary-container text-on-secondary-container hover:shadow-e1',
  outlined: 'border border-outline text-primary',
  text: 'text-primary',
  inverse: 'bg-surface-lowest text-primary hover:shadow-e2',
};

const sizes = { md: 'h-10 px-6', lg: 'h-14 px-8 text-[0.95rem]' };

type BtnOwn = { variant?: Variant; size?: keyof typeof sizes; icon?: IconName; trailingIcon?: IconName; children: ReactNode };

export function buttonClass(variant: Variant = 'filled', size: keyof typeof sizes = 'md', extra = '') {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({ variant, size, icon, trailingIcon, children, className = '', ...rest }: BtnOwn & ComponentProps<'button'>) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} size={20} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={20} />}
    </button>
  );
}

export function LinkButton({ variant, size, icon, trailingIcon, children, className = '', href, ...rest }: BtnOwn & ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} size={20} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={20} />}
    </Link>
  );
}

// Chip de sugestão/assist (não interativo)
export function AssistChip({ icon, children, className = '' }: { icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-8 items-center gap-2 rounded-sm border border-outline-variant px-3 text-label-l text-on-surface-variant ${className}`}>
      {icon && <Icon name={icon} size={18} className="text-primary" />}
      {children}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-label-l uppercase tracking-[0.14em] text-primary">{children}</p>;
}
