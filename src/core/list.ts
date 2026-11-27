import type { Source } from './types';

/** Shareable mapping list: YouTube video id → Bilibili pages with offsets. See docs/list-format.md. */
export const LIST_FORMAT = 'bili2ytb-list/1';
export const MAX_ENTRIES_PER_VIDEO = 10;

export interface ListEntry {
  bvid: string;
  /** 1-based */
  page: number;
  /** seconds */
  offset: number;
}

export interface MappingList {
  name: string;
  homepage?: string;
  updated?: string;
  entries: Record<string, ListEntry[]>;
}

const YT_ID = /^[\w-]{11}$/;
const BVID = /^BV[0-9A-Za-z]{10}$/;

function parseEntry(e: unknown): ListEntry | null {
  if (!e || typeof e !== 'object') return null;
  const { bvid, page = 1, offset = 0 } = e as Record<string, unknown>;
  if (typeof bvid !== 'string' || !BVID.test(bvid)) return null;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return null;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  return { bvid, page, offset: Math.round(offset * 10) / 10 };
}

/** Validates a downloaded list. Throws if the file isn't a list; silently drops bad entries. */
export function parseList(json: unknown): MappingList {
  if (!json || typeof json !== 'object') throw new Error('不是有效的 JSON 对象');
  const o = json as Record<string, unknown>;
  if (o.format !== LIST_FORMAT) throw new Error(`不是 ${LIST_FORMAT} 格式的订阅文件`);
  if (!o.entries || typeof o.entries !== 'object' || Array.isArray(o.entries))
    throw new Error('订阅文件缺少 entries');
  const entries: Record<string, ListEntry[]> = {};
  for (const [ytId, list] of Object.entries(o.entries as Record<string, unknown>)) {
    if (!YT_ID.test(ytId) || !Array.isArray(list)) continue;
    const seen = new Set<string>();
    const ok: ListEntry[] = [];
    for (const raw of list) {
      const e = parseEntry(raw);
      if (!e || seen.has(`${e.bvid}-${e.page}`)) continue;
      seen.add(`${e.bvid}-${e.page}`);
      ok.push(e);
      if (ok.length >= MAX_ENTRIES_PER_VIDEO) break;
    }
    if (ok.length) entries[ytId] = ok;
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const homepage = str(o.homepage, 500);
  return {
    name: str(o.name, 100) ?? '未命名列表',
    ...(homepage && /^https?:\/\//.test(homepage) ? { homepage } : {}),
    ...(str(o.updated, 40) ? { updated: str(o.updated, 40) } : {}),
    entries,
  };
}

/** Builds a shareable list from local bindings. Imported local files are skipped. */
export function buildList(
  bindings: Record<string, Source[]>,
  meta: { name: string; homepage?: string },
  now = new Date(),
): { format: string } & MappingList {
  const entries: Record<string, ListEntry[]> = {};
  for (const [ytId, sources] of Object.entries(bindings)) {
    const list = sources
      .filter((s) => s.kind !== 'file' && BVID.test(s.bvid))
      .map((s) => ({ bvid: s.bvid, page: s.page, offset: s.offset }));
    if (YT_ID.test(ytId) && list.length) entries[ytId] = list;
  }
  return {
    format: LIST_FORMAT,
    name: meta.name.trim() || '我的弹幕对照表',
    ...(meta.homepage ? { homepage: meta.homepage } : {}),
    updated: now.toISOString(),
    entries,
  };
}
