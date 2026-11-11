// Campos de formulário Material Design 3
import type { ChangeEventHandler, ComponentProps, ReactNode } from 'react';
import { Icon } from './icons';

export function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 flex items-center gap-1 px-4 text-body-s text-error" role="alert">
      <Icon name="error" size={16} /> {children}
    </p>
  );
}

// Outlined text field com rótulo flutuante
export function TextField({
  label, name, error, supporting, multiline, rows, className = '', ...rest
}: {
  label: string; name: string; error?: string; supporting?: string; multiline?: boolean; className?: string;
} & Omit<ComponentProps<'input'>, 'name'> & Pick<ComponentProps<'textarea'>, 'rows'>) {
  const id = `f-${name}`;
  const errId = `${id}-err`;
  const supId = `${id}-sup`;
  const shared =
    'peer block w-full rounded-xs border bg-transparent px-4 text-body-l text-on-surface outline-none transition-colors ' +
    'placeholder-transparent focus:border-2 focus:px-[15px] ' +
    (error ? 'border-error focus:border-error' : 'border-outline hover:border-on-surface focus:border-primary');
  const describedBy = [error ? errId : null, supporting ? supId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <div className="relative">
        {multiline ? (
          <textarea
            id={id} name={name} placeholder=" " rows={rows ?? 4}
            defaultValue={rest.defaultValue as string}
            aria-invalid={!!error} aria-describedby={describedBy}
            maxLength={rest.maxLength}
            className={`${shared} resize-y pb-3 pt-4 focus:pt-[15px]`}
          />
        ) : (
          <input
            id={id} name={name} placeholder=" " aria-invalid={!!error} aria-describedby={describedBy}
            className={`${shared} h-14 focus:pt-0`} {...rest}
          />
        )}
        <label
          htmlFor={id}
          className={
            'pointer-events-none absolute left-3 top-0 -translate-y-1/2 bg-surface-lowest px-1 text-body-s transition-all duration-150 ' +
            (multiline ? 'peer-placeholder-shown:top-7 ' : 'peer-placeholder-shown:top-1/2 ') +
            'peer-placeholder-shown:text-body-l peer-focus:top-0 peer-focus:text-body-s ' +
            (error ? 'text-error' : 'text-on-surface-variant peer-focus:text-primary')
          }
        >
          {label}
        </label>
      </div>
      {supporting && !error && <p id={supId} className="mt-1.5 px-4 text-body-s text-on-surface-variant">{supporting}</p>}
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
}

export function Fieldset({ legend, hint, error, name, children }: { legend: string; hint?: string; error?: string; name: string; children: ReactNode }) {
  return (
    <fieldset aria-describedby={error ? `f-${name}-err` : undefined}>
      <legend className="text-title-s">{legend}</legend>
      {hint && <p className="mt-0.5 text-body-s text-on-surface-variant">{hint}</p>}
      <div className="mt-3">{children}</div>
      <FieldError id={`f-${name}-err`}>{error}</FieldError>
    </fieldset>
  );
}

// Segmented button (seleção única) com rádios nativos
export function Segmented({ name, options, defaultValue }: { name: string; options: readonly { value: string; label: string }[]; defaultValue?: string }) {
  return (
    <div className="flex overflow-hidden rounded-full border border-outline">
      {options.map((o, i) => (
        <label
          key={o.value}
          className={
            'state-layer relative flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 px-2 py-1.5 text-center text-label-l leading-tight text-on-surface sm:px-3 ' +
            'has-[:checked]:bg-secondary-container has-[:checked]:text-on-secondary-container has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-primary ' +
            (i > 0 ? 'border-l border-outline' : '')
          }
        >
          <input type="radio" name={name} value={o.value} defaultChecked={defaultValue === o.value} className="peer sr-only" />
          <Icon name="check" size={18} className="hidden peer-checked:block max-sm:!hidden" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// Filter chips (seleção múltipla) com checkboxes nativos
export function FilterChips({ name, options, defaultValues = [] }: { name: string; options: readonly { value: string; label: string }[]; defaultValues?: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className={
            'state-layer inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-outline px-3 text-label-l text-on-surface-variant ' +
            'has-[:checked]:border-transparent has-[:checked]:bg-secondary-container has-[:checked]:text-on-secondary-container ' +
            'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary'
          }
        >
          <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} className="peer sr-only" />
          <Icon name="check" size={18} className="-ml-1 hidden peer-checked:block" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// Radio list
export function RadioList({ name, options, defaultValue }: { name: string; options: readonly { value: string; label: string }[]; defaultValue?: string }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2 py-1.5 text-body-l">
          <span className="state-layer grid size-10 place-items-center rounded-full text-on-surface-variant has-[:checked]:text-primary">
            <input type="radio" name={name} value={o.value} defaultChecked={defaultValue === o.value} className="peer sr-only" />
            <span className="grid size-5 place-items-center rounded-full border-2 border-current peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-primary peer-checked:[&>span]:block">
              <span className="hidden size-2.5 rounded-full bg-current" />
            </span>
          </span>
          {o.label}
        </label>
      ))}
    </div>
  );
}

// Select nativo com aparência de outlined field
export function SelectField({ label, name, options, defaultValue, error, onChange }: { label: string; name: string; options: readonly { value: string; label: string }[]; defaultValue?: string; error?: string; onChange?: ChangeEventHandler<HTMLSelectElement> }) {
  const id = `f-${name}`;
  return (
    <div>
      <div className="relative">
        <select
          id={id}
          name={name}
          defaultValue={defaultValue ?? ''}
          onChange={onChange}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          className={
            'h-14 w-full cursor-pointer appearance-none rounded-xs border bg-transparent pl-4 pr-12 text-body-l outline-none focus:border-2 focus:pl-[15px] ' +
            (error ? 'border-error' : 'border-outline hover:border-on-surface focus:border-primary')
          }
        >
          <option value="" disabled>Selecione…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label htmlFor={id} className={`pointer-events-none absolute left-3 top-0 -translate-y-1/2 bg-surface-lowest px-1 text-body-s ${error ? 'text-error' : 'text-on-surface-variant'}`}>
          {label}
        </label>
        <Icon name="keyboard_arrow_down" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
      </div>
      <FieldError id={`${id}-err`}>{error}</FieldError>
    </div>
  );
}

export function Checkbox({ name, children, defaultChecked, error }: { name: string; children: ReactNode; defaultChecked?: boolean; error?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-2 text-body-m text-on-surface-variant">
        <span className={`state-layer -m-2 grid size-10 shrink-0 place-items-center rounded-full ${error ? 'text-error' : 'text-on-surface-variant'}`}>
          <input type="checkbox" name={name} defaultChecked={defaultChecked} aria-invalid={!!error} aria-describedby={error ? `f-${name}-err` : undefined} className="peer sr-only" />
          <span className={`grid size-[18px] place-items-center rounded-[2px] border-2 text-on-primary ${error ? 'border-error' : 'border-on-surface-variant'} peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-primary peer-checked:[&>svg]:block`}>
            <Icon name="check" size={16} className="hidden" />
          </span>
        </span>
        <span className="pt-0.5">{children}</span>
      </label>
      <FieldError id={`f-${name}-err`}>{error}</FieldError>
    </div>
  );
}

// Switch M3 com checkbox nativo (envia "on" quando ligado)
export function Switch({ name, label, description, defaultChecked, onChange, error }: { name: string; label: string; description?: string; defaultChecked?: boolean; onChange?: (on: boolean) => void; error?: string }) {
  return (
    <div>
    <label className="flex cursor-pointer items-center justify-between gap-6 py-1">
      <span>
        <span className="block text-body-l text-on-surface">{label}</span>
        {description && <span className="block text-body-s text-on-surface-variant">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} onChange={(e) => onChange?.(e.target.checked)} className="peer sr-only" />
        <span className="h-8 w-[52px] rounded-full border-2 border-outline bg-surface-highest transition-colors duration-200 peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" />
        <span className="pointer-events-none absolute left-2 top-2 size-4 rounded-full bg-outline transition-all duration-200 peer-checked:left-[24px] peer-checked:top-1 peer-checked:size-6 peer-checked:bg-on-primary" />
      </span>
    </label>
    <FieldError id={`f-${name}-err`}>{error}</FieldError>
    </div>
  );
}
