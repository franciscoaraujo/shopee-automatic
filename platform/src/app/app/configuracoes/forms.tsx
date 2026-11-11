'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Fieldset, FilterChips, SelectField, Switch, TextField } from '@/components/form-fields';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import type { Result } from '@/server/integrations';
import { SECTIONS, type FieldDef, type PublicSettings, type SectionId } from '@/lib/settings-schema';
import {
  clearSecretAction, saveSectionAction, testShopeeAction, testTelegramAction,
  waConnectAction, waDisconnectAction, waGroupsAction, waSelectGroupAction, waStatusAction, type SaveState,
} from '../actions';

/* ------------------------------------------------------------------ utilitários */
export function Feedback({ result, pending }: { result: Result | null; pending?: boolean }) {
  if (pending) return <p className="flex items-center gap-2 text-body-m text-on-surface-variant" role="status"><Icon name="sync" size={18} className="animate-spin" /> Testando…</p>;
  if (!result) return null;
  return (
    <p className={`flex items-start gap-2 text-body-m ${result.ok ? 'text-success' : 'text-error'}`} role="status">
      <Icon name={result.ok ? 'check_circle_fill' : 'error'} size={18} className="mt-px" />
      {result.message}
    </p>
  );
}

function SavedNote({ state }: { state: SaveState }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!state.ok) return;
    const on = setTimeout(() => setShow(true), 0);
    const off = setTimeout(() => setShow(false), 2600);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, [state]);
  if (state.errors?.form) return <p className="text-body-m text-error">{state.errors.form}</p>;
  return show ? <p className="flex items-center gap-1.5 text-body-m text-success" role="status"><Icon name="check" size={18} /> {state.message}</p> : null;
}

function FieldInput({ f, s, error, typed, timeBounds }: { f: FieldDef; s: PublicSettings; error?: string; typed?: string; timeBounds?: { min: string; max: string } }) {
  const saved = (s as unknown as Record<string, unknown>)[f.key];
  // Após um erro, mostra o que a pessoa digitou; senão, o valor salvo
  const v: unknown = typed === undefined ? saved
    : f.type === 'bool' ? typed === 'on'
    : f.type === 'percent' ? (typed === '' ? '' : Number(typed) / 100)
    : typed;
  switch (f.type) {
    case 'bool':
      return <Switch name={f.key} label={f.label} defaultChecked={Boolean(v)} error={error} />;
    case 'secret': {
      const sec = v as { isSet: boolean; hint: string | null };
      return <SecretField f={f} isSet={sec.isSet} hint={sec.hint} error={error} />;
    }
    case 'select':
      return <SelectField label={f.label} name={f.key} options={f.options.map((o) => ({ value: String(o.value), label: o.label }))} defaultValue={String(v)} error={error} />;
    case 'time':
      return <TextField label={f.label} name={f.key} type="time" step={300} min={timeBounds?.min} max={timeBounds?.max} defaultValue={String(v)} supporting={timeBounds ? `Entre ${timeBounds.min} e ${timeBounds.max}` : undefined} error={error} />;
    case 'days':
      return (
        <Fieldset legend={f.label} name={f.key} error={error}>
          <FilterChips name={f.key} options={f.options} defaultValues={String(v ?? '').split(',')} />
        </Fieldset>
      );
    case 'percent':
      return <TextField label={`${f.label} (%)`} name={f.key} type="number" inputMode="decimal" step="0.5" min={0} max={100} defaultValue={v === '' ? '' : String(+((v as number) * 100).toFixed(2))} error={error} />;
    case 'number':
      return <TextField label={f.suffix ? `${f.label} (${f.suffix})` : f.label} name={f.key} type="number" inputMode="decimal" step={String(f.step)} min={f.min} max={f.max} defaultValue={String(v)} supporting={f.help} error={error} />;
    default:
      return <TextField label={f.label} name={f.key} defaultValue={(v as string) ?? ''} supporting={f.help ?? (f.placeholder ? `Ex.: ${f.placeholder}` : undefined)} error={error} spellCheck={false} />;
  }
}

function SecretField({ f, isSet, hint, error }: { f: FieldDef; isSet: boolean; hint: string | null; error?: string }) {
  const [show, setShow] = useState(false);
  const [removing, start] = useTransition();
  return (
    <div>
      <div className="flex items-start gap-2">
        <TextField
          className="flex-1"
          label={f.label}
          name={f.key}
          type={show ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          supporting={isSet ? `Salvo (${hint}). Deixe vazio para manter.` : 'Não configurado'}
          error={error}
        />
        <button type="button" onClick={() => setShow((x) => !x)} className="state-layer mt-2 grid size-10 place-items-center rounded-full text-on-surface-variant" aria-label={show ? 'Ocultar' : 'Mostrar'}>
          <Icon name={show ? 'visibility_off' : 'visibility'} />
        </button>
      </div>
      {isSet && (
        <button type="button" disabled={removing} onClick={() => start(() => clearSecretAction(f.key as 'shopeeSecret' | 'telegramBotToken'))} className="ml-4 mt-1 text-label-m text-error hover:underline">
          {removing ? 'Removendo…' : 'Remover valor salvo'}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ formulário de seção */
export function SectionForm({
  section, settings, onlyKeys, test, columns = 1, children, timeBounds,
}: {
  section: SectionId; settings: PublicSettings; onlyKeys?: string[]; columns?: 1 | 2; timeBounds?: { min: string; max: string };
  test?: (form: HTMLFormElement) => Promise<Result>;
  children?: React.ReactNode;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveSectionAction.bind(null, section), {});
  const [testRes, setTestRes] = useState<Result | null>(null);
  const [testing, startTest] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const fields = (SECTIONS[section] as FieldDef[]).filter((f) => !onlyKeys || onlyKeys.includes(f.key));

  return (
    <form ref={formRef} action={action} key={state.n} noValidate className="space-y-5">
      <div className={columns === 2 ? 'grid gap-5 sm:grid-cols-2' : 'space-y-5'}>
        {fields.map((f) => (
          <div key={f.key} className={columns === 2 && (f.key === 'keywords' || f.type === 'bool' || f.type === 'days') ? 'sm:col-span-2' : ''}>
            <FieldInput f={f} s={settings} error={state.errors?.[f.key]} typed={state.values?.[f.key]} timeBounds={timeBounds} />
          </div>
        ))}
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant/70 pt-5">
        <Button type="submit" disabled={pending}>{pending ? 'Salvando…' : 'Salvar'}</Button>
        {test && (
          <Button type="button" variant="outlined" disabled={testing} onClick={() => startTest(async () => setTestRes(await test(formRef.current!)))}>
            Testar conexão
          </Button>
        )}
        <SavedNote state={state} />
      </div>
      <Feedback result={testRes} pending={testing} />
    </form>
  );
}

const val = (f: HTMLFormElement, name: string) => String((f.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '');
export const shopeeTest = (f: HTMLFormElement) => testShopeeAction(val(f, 'shopeeAppId'), val(f, 'shopeeSecret'));
export const telegramTest = (f: HTMLFormElement) => testTelegramAction(val(f, 'telegramBotToken'), val(f, 'telegramChatId'));

export function ShopeeForm({ settings }: { settings: PublicSettings }) {
  return <SectionForm section="shopee" settings={settings} test={shopeeTest} />;
}
export function TelegramForm({ settings }: { settings: PublicSettings }) {
  return <SectionForm section="telegram" settings={settings} test={telegramTest} />;
}
export function ScheduleForm({ settings, mode, earliest, latest }: { settings: PublicSettings; mode: 'bounded' | 'full'; earliest?: string; latest?: string }) {
  // No Pro (bounded) sempre há janela: o interruptor "só em horários definidos" não aparece
  const keys = mode === 'bounded' ? ['scheduleStart', 'scheduleEnd', 'scheduleDays'] : undefined;
  const s = mode === 'bounded' && !settings.scheduleEnabled ? { ...settings, scheduleStart: earliest!, scheduleEnd: latest! } : settings;
  return <SectionForm section="schedule" settings={s} columns={2} onlyKeys={keys} timeBounds={mode === 'bounded' ? { min: earliest!, max: latest! } : undefined} />;
}

/* ------------------------------------------------------------------ WhatsApp */
type WaUi = 'open' | 'connecting' | 'close' | 'missing' | 'error';

export function WhatsAppPanel({ initialState, initialError, settings }: { initialState: WaUi; initialError?: string; settings: PublicSettings }) {
  const router = useRouter();
  const [state, setState] = useState<WaUi>(initialState);
  const [error, setError] = useState<string | undefined>(initialError);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [groups, setGroups] = useState<{ id: string; subject: string; size: number | null }[] | null>(null);
  const [groupMsg, setGroupMsg] = useState<Result | null>(null);

  // Enquanto o QR está na tela: confere o estado a cada 3 s e renova o QR a cada 25 s
  useEffect(() => {
    if (!qr) return;
    let alive = true;
    const poll = setInterval(async () => {
      const s = await waStatusAction();
      if (!alive) return;
      if (s.state === 'open') {
        setQr(null);
        setState('open');
        router.refresh();
      }
    }, 3000);
    const renew = setInterval(async () => {
      const r = await waConnectAction();
      if (alive && r.qr) setQr(r.qr);
    }, 25000);
    return () => { alive = false; clearInterval(poll); clearInterval(renew); };
  }, [qr, router]);

  const connect = () => start(async () => {
    setError(undefined);
    const r = await waConnectAction();
    if (r.error) { setError(r.error); setState('error'); return; }
    if (r.state === 'open') { setState('open'); router.refresh(); return; }
    setQr(r.qr);
    setState('connecting');
  });

  const loadGroups = () => start(async () => {
    setGroupMsg(null);
    const r = await waGroupsAction();
    if (r.error) setGroupMsg({ ok: false, message: r.error });
    else setGroups(r.groups ?? []);
  });

  const choose = (jid: string) => start(async () => {
    const g = groups?.find((x) => x.id === jid);
    const r = await waSelectGroupAction(jid, g?.subject ?? '');
    setGroupMsg(r.ok ? { ok: true, message: r.message! } : { ok: false, message: r.errors?.whatsappGroupJid ?? 'Erro ao salvar' });
    if (r.ok) router.refresh();
  });

  const disconnect = () => start(async () => {
    if (!confirm('Desconectar este WhatsApp? A esteira para de publicar no grupo até você conectar de novo.')) return;
    await waDisconnectAction();
    setState('missing');
    setGroups(null);
    router.refresh();
  });

  if (state !== 'open') {
    return (
      <div className="space-y-5">
        {qr ? (
          <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR Code para conectar o WhatsApp" width={232} height={232} className="rounded-lg border border-outline-variant bg-white p-2" />
            <ol className="list-decimal space-y-2 pl-5 text-body-l">
              <li>No celular, abra o WhatsApp</li>
              <li>Toque em <b>⋮</b> ou <b>Configurações</b> → <b>Aparelhos conectados</b></li>
              <li>Toque em <b>Conectar um aparelho</b> e aponte para o código</li>
              <li className="list-none pt-2 text-body-m text-on-surface-variant">
                <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-tertiary animate-pulse-dot" /> Aguardando leitura… o código se renova sozinho.</span>
              </li>
            </ol>
          </div>
        ) : (
          <p className="text-body-l text-on-surface-variant">
            Use um número dedicado ao grupo de ofertas (não o pessoal). Ele precisa participar do grupo onde as ofertas serão publicadas.
          </p>
        )}
        {error && <Feedback result={{ ok: false, message: error }} />}
        {!qr && (
          <Button type="button" icon="qr_code_2" onClick={connect} disabled={busy}>
            {busy ? 'Gerando QR Code…' : 'Conectar WhatsApp'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-success-container px-3 text-label-l text-on-success-container">
          <Icon name="check_circle_fill" size={18} /> Conectado
        </span>
        <button type="button" onClick={disconnect} disabled={busy} className="state-layer rounded-full px-3 py-1.5 text-label-l text-error">
          Desconectar
        </button>
      </div>

      <div>
        <p className="text-title-s">Grupo de destino</p>
        <p className="mt-1 text-body-m text-on-surface-variant">
          {settings.whatsappGroupJid ? <>Publicando em <b className="text-on-surface">“{settings.whatsappGroupName || settings.whatsappGroupJid}”</b>.</> : 'Nenhum grupo escolhido ainda.'}
        </p>
        {groups ? (
          <div className="mt-4 max-w-md">
            <SelectField
              label={groups.length ? `Escolha entre ${groups.length} grupos` : 'Nenhum grupo encontrado'}
              name="group"
              options={groups.map((g) => ({ value: g.id, label: g.size ? `${g.subject} (${g.size})` : g.subject }))}
              defaultValue={settings.whatsappGroupJid ?? undefined}
              onChange={(e) => e.target.value && choose(e.target.value)}
            />
          </div>
        ) : (
          <Button type="button" variant="tonal" icon="groups" className="mt-4" onClick={loadGroups} disabled={busy}>
            {busy ? 'Carregando grupos…' : settings.whatsappGroupJid ? 'Trocar grupo' : 'Escolher grupo'}
          </Button>
        )}
        <div className="mt-3"><Feedback result={groupMsg} /></div>
        {groups && groups.length === 0 && <p className="mt-2 text-body-s text-on-surface-variant">Logo após conectar, a lista pode levar 1–2 minutos para sincronizar.</p>}
      </div>

      <SectionForm section="whatsapp" settings={settings} onlyKeys={['whatsappEnabled']} />
    </div>
  );
}
