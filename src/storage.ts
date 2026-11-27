import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Settings, type Source } from './core/types';

const SETTINGS_KEY = 'settings';
const SUBS_KEY = 'subscriptions';
const bindingKey = (ytId: string) => `binding:${ytId}`;

export async function loadSettings(): Promise<Settings> {
  const r = await browser.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...((r[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {}) };
}

let saving: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write of the whole settings object. Calls are queued: two change events firing together
 * (e.g. a text field's blur and a checkbox click) would otherwise both read the old value and the later
 * write would drop the earlier one's change.
 */
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = saving.then(async () => {
    const next = { ...(await loadSettings()), ...patch };
    await browser.storage.sync.set({ [SETTINGS_KEY]: next });
    return next;
  });
  saving = run.catch(() => {});
  return run;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'sync' && changes[SETTINGS_KEY])
      cb({ ...DEFAULT_SETTINGS, ...((changes[SETTINGS_KEY].newValue as Partial<Settings>) ?? {}) });
  };
  browser.storage.onChanged.addListener(listener);
  // Called from ctx.onInvalidated: after the extension is reloaded/updated, Chrome has already
  // detached the old content script from extension APIs, so `browser.storage` is undefined.
  return () => browser.storage?.onChanged.removeListener(listener);
}

export async function loadBinding(ytId: string): Promise<Source[]> {
  const r = await browser.storage.local.get(bindingKey(ytId));
  return (r[bindingKey(ytId)] as Source[] | undefined) ?? [];
}

export async function saveBinding(ytId: string, sources: Source[]): Promise<void> {
  if (sources.length === 0) await browser.storage.local.remove(bindingKey(ytId));
  else await browser.storage.local.set({ [bindingKey(ytId)]: sources });
}

/** All bindings, for export. */
export async function exportBindings(): Promise<Record<string, Source[]>> {
  const all = await browser.storage.local.get(null);
  const out: Record<string, Source[]> = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith('binding:')) out[k.slice(8)] = v as Source[];
  return out;
}

export async function importBindings(data: Record<string, Source[]>): Promise<number> {
  const entries = Object.entries(data).filter(([k, v]) => /^[\w-]{11}$/.test(k) && Array.isArray(v));
  await browser.storage.local.set(Object.fromEntries(entries.map(([k, v]) => [bindingKey(k), v])));
  return entries.length;
}

/** Subscribed mapping lists, in priority order. Kept in sync storage so they follow the user's Chrome profile. */
export interface Subscription {
  url: string;
  enabled: boolean;
}

export async function loadSubscriptions(): Promise<Subscription[]> {
  const r = await browser.storage.sync.get(SUBS_KEY);
  return (r[SUBS_KEY] as Subscription[] | undefined) ?? [];
}

export async function saveSubscriptions(subs: Subscription[]): Promise<void> {
  await browser.storage.sync.set({ [SUBS_KEY]: subs });
}

export function onSubscriptionsChanged(cb: (next: Subscription[], prev: Subscription[]) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => {
    const c = changes[SUBS_KEY];
    if (area === 'sync' && c) cb((c.newValue as Subscription[]) ?? [], (c.oldValue as Subscription[]) ?? []);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage?.onChanged.removeListener(listener);
}
