/** Background side of mapping-list subscriptions: download, cache in IndexedDB, look up. */
import { type ListEntry, type MappingList, parseList } from './core/list';
import { idbDelete, idbGet, idbPut } from './idb';
import { loadSubscriptions, saveSubscriptions, type Subscription } from './storage';

export const MAX_LIST_BYTES = 5 * 1024 * 1024;
export const REFRESH_MINUTES = 12 * 60;

interface CachedList {
  url: string;
  list?: MappingList;
  etag?: string;
  /** ms */
  fetchedAt?: number;
  error?: string;
  /** the error was most likely a missing CORS header / host permission */
  needsPermission?: boolean;
}

export interface ListStatus {
  url: string;
  name?: string;
  homepage?: string;
  count: number;
  updated?: string;
  fetchedAt?: number;
  error?: string;
  needsPermission?: boolean;
}

export interface ListSuggestion {
  url: string;
  name: string;
  entries: ListEntry[];
}

function status(c: CachedList | undefined, url: string): ListStatus {
  return {
    url,
    name: c?.list?.name,
    homepage: c?.list?.homepage,
    count: c?.list ? Object.keys(c.list.entries).length : 0,
    updated: c?.list?.updated,
    fetchedAt: c?.fetchedAt,
    error: c?.error,
    needsPermission: c?.needsPermission,
  };
}

async function readLimited(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_LIST_BYTES) throw new Error('订阅文件超过 5 MB');
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_LIST_BYTES) {
      void reader.cancel();
      throw new Error('订阅文件超过 5 MB');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Downloads one list. On failure the previous copy is kept and the error recorded. */
export async function refreshList(url: string): Promise<ListStatus> {
  const prev = await idbGet<CachedList>('lists', url).catch(() => undefined);
  const next: CachedList = { ...prev, url };
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        credentials: 'omit',
        cache: 'no-cache',
        headers: prev?.etag && prev.list ? { 'If-None-Match': prev.etag } : {},
      });
    } catch {
      // fetch() rejects without detail for CORS failures as well as for network errors.
      next.needsPermission = true;
      throw new Error(
        url.startsWith('https:')
          ? '无法读取：网络错误，或该网站不允许跨域读取（可点"授权"后重试）'
          : '无法读取：网络错误，或该网站不允许跨域读取',
      );
    }
    next.needsPermission = false;
    if (res.status === 304 && prev?.list) {
      next.fetchedAt = Date.now();
      next.error = undefined;
    } else {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let json: unknown;
      try {
        json = JSON.parse(await readLimited(res));
      } catch (e) {
        throw new Error(e instanceof SyntaxError ? '不是有效的 JSON' : (e as Error).message);
      }
      next.list = parseList(json);
      next.etag = res.headers.get('etag') ?? undefined;
      next.fetchedAt = Date.now();
      next.error = undefined;
    }
  } catch (e) {
    next.error = (e as Error).message;
  }
  await idbPut('lists', url, next);
  return status(next, url);
}

export async function refreshAll(onlyStale = false): Promise<ListStatus[]> {
  const subs = (await loadSubscriptions()).filter((s) => s.enabled);
  const out: ListStatus[] = [];
  for (const s of subs) {
    if (onlyStale) {
      const c = await idbGet<CachedList>('lists', s.url).catch(() => undefined);
      if (c?.fetchedAt && Date.now() - c.fetchedAt < REFRESH_MINUTES * 60_000) continue;
    }
    out.push(await refreshList(s.url));
  }
  return out;
}

export async function listStatus(): Promise<ListStatus[]> {
  const subs = await loadSubscriptions();
  return Promise.all(
    subs.map(async (s) => status(await idbGet<CachedList>('lists', s.url).catch(() => undefined), s.url)),
  );
}

export async function forgetList(url: string): Promise<void> {
  await idbDelete('lists', url).catch(() => {});
}

/** Entries for one YouTube video from every enabled subscription, in priority order. */
export async function lookup(ytId: string): Promise<ListSuggestion[]> {
  const subs = (await loadSubscriptions()).filter((s) => s.enabled);
  const out: ListSuggestion[] = [];
  for (const s of subs) {
    const c = await idbGet<CachedList>('lists', s.url).catch(() => undefined);
    const entries = c?.list?.entries[ytId];
    if (entries?.length) out.push({ url: s.url, name: c!.list!.name, entries });
  }
  return out;
}

/** Downloads first, then saves the subscription, so the storage listener sees it already cached. */
export async function subscribe(url: string): Promise<ListStatus> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error('不是有效的网址');
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))
    throw new Error('订阅地址必须是 https 网址');
  const subs = await loadSubscriptions();
  if (subs.some((s) => s.url === u.href)) throw new Error('已经订阅过这个地址');
  const st = await refreshList(u.href);
  if (!st.name) {
    await forgetList(u.href);
    throw Object.assign(new Error(`订阅失败：${st.error ?? '未知错误'}`), { needsPermission: st.needsPermission });
  }
  await saveSubscriptions([...(await loadSubscriptions()), { url: u.href, enabled: true }]);
  return st;
}

/** Reacts to subscription edits from the popup or from another synced device. */
export async function onSubscriptionsEdited(next: Subscription[], prev: Subscription[]) {
  const keep = new Set(next.map((s) => s.url));
  for (const s of prev) if (!keep.has(s.url)) await forgetList(s.url);
  for (const s of next) {
    if (!s.enabled) continue;
    const c = await idbGet<CachedList>('lists', s.url).catch(() => undefined);
    if (!c) await refreshList(s.url);
  }
}
