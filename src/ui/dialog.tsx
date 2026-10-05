/**
 * In-app confirmation and text-input dialogs (instead of the browser's confirm/prompt).
 * `confirmDialog` / `promptDialog` return promises; a single <DialogHost /> at the app root renders them.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '../i18n';

interface Request {
  kind: 'confirm' | 'prompt';
  title?: string;
  message: string;
  /** Label of the confirming button (defaults to "OK"). */
  okLabel?: string;
  /** Destructive action: the confirming button is red. */
  danger?: boolean;
  /** Initial text of a prompt. */
  value?: string;
  resolve: (result: string | null) => void;
}

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function open(req: Omit<Request, 'resolve'>): Promise<string | null> {
  // A new request replaces a pending one, which counts as cancelled.
  current?.resolve(null);
  return new Promise((resolve) => {
    current = { ...req, resolve };
    emit();
  });
}

function close(result: string | null) {
  const req = current;
  current = null;
  emit();
  req?.resolve(result);
}

export type DialogOptions = Pick<Request, 'title' | 'okLabel' | 'danger'>;

export async function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  return (await open({ kind: 'confirm', message, ...options })) !== null;
}

/** Resolves to the entered text (trimmed), or null when cancelled or left empty. */
export async function promptDialog(message: string, value = '', options: DialogOptions = {}): Promise<string | null> {
  const text = await open({ kind: 'prompt', message, value, ...options });
  return text?.trim() ? text.trim() : null;
}

/** A dialog is shown: global keyboard shortcuts must stay quiet. */
export const isDialogOpen = () => current !== null;

export function DialogHost() {
  const req = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return req ? <Dialog key={`${req.kind}:${req.message}`} req={req} /> : null;
}

function Dialog({ req }: { req: Request }) {
  const t = useT();
  const [value, setValue] = useState(req.value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (req.kind === 'prompt') inputRef.current?.select();
    else okRef.current?.focus();
    // Enter confirms, Escape cancels; handled before the app shortcuts and the photo viewer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('.dialog button')) {
        e.preventDefault();
        close(req.kind === 'prompt' ? valueRef.current : '');
      } else return;
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [req]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={req.title ?? req.message}>
        {req.title && <h3>{req.title}</h3>}
        <p>{req.message}</p>
        {req.kind === 'prompt' && <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} />}
        <div className="dialog-buttons">
          <button onClick={() => close(null)}>{t('dialog.cancel')}</button>
          <button
            ref={okRef}
            className={req.danger ? 'danger-solid' : 'primary'}
            disabled={req.kind === 'prompt' && !value.trim()}
            onClick={() => close(req.kind === 'prompt' ? value : '')}
          >
            {req.okLabel ?? t('dialog.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
