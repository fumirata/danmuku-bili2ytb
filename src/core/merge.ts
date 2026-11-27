import { buildFilter } from './filter';
import type { PlacedComment, RawComment, Settings, Source } from './types';

export type MergeSettings = Pick<
  Settings,
  'blockModes' | 'blockKeywords' | 'dedupe' | 'dedupeWindow' | 'maxPerSecond'
>;

/** Normalizes text for duplicate detection: NFKC, lower case, no whitespace, collapse repeated tails like "哈哈哈哈". */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(.)\1{2,}$/u, '$1$1$1');
}

/**
 * Places comments from every enabled source on the YouTube timeline:
 * apply offset → filter → dedupe → density limit → sort by time.
 */
export function mergeComments(
  sources: Source[],
  commentsBySource: Map<string, RawComment[]>,
  settings: MergeSettings,
): PlacedComment[] {
  const keep = buildFilter(settings);
  let placed: PlacedComment[] = [];
  for (const s of sources) {
    if (!s.enabled) continue;
    const list = commentsBySource.get(s.id);
    if (!list) continue;
    for (const c of list) {
      const time = c.time + s.offset;
      if (time < 0) continue;
      if (!keep(c)) continue;
      placed.push({ ...c, time, sourceId: s.id, count: 1 });
    }
  }
  placed.sort((a, b) => a.time - b.time);

  if (settings.dedupe && settings.dedupeWindow > 0) placed = dedupe(placed, settings.dedupeWindow);
  if (settings.maxPerSecond > 0) placed = limitDensity(placed, settings.maxPerSecond);
  return placed;
}

/** Merges identical (normalized) texts that appear within `window` seconds of the first one. Input must be sorted. */
export function dedupe(sorted: PlacedComment[], window: number): PlacedComment[] {
  const out: PlacedComment[] = [];
  const lastByKey = new Map<string, PlacedComment>();
  for (const c of sorted) {
    const key = c.mode + '|' + normalizeText(c.text);
    const prev = lastByKey.get(key);
    if (prev && c.time - prev.time <= window) {
      prev.count++;
      if (c.weight > prev.weight) prev.weight = c.weight;
      continue;
    }
    const copy = { ...c };
    lastByKey.set(key, copy);
    out.push(copy);
  }
  return out;
}

/** Keeps at most `max` comments per one-second bucket, preferring merged and higher-weight ones. Input must be sorted. */
export function limitDensity(sorted: PlacedComment[], max: number): PlacedComment[] {
  const out: PlacedComment[] = [];
  let i = 0;
  while (i < sorted.length) {
    const bucket = Math.floor(sorted[i]!.time);
    let j = i;
    while (j < sorted.length && Math.floor(sorted[j]!.time) === bucket) j++;
    const group = sorted.slice(i, j);
    if (group.length <= max) out.push(...group);
    else {
      const chosen = new Set(
        group
          .map((c, idx) => ({ c, idx }))
          .sort((a, b) => b.c.count - a.c.count || b.c.weight - a.c.weight || a.idx - b.idx)
          .slice(0, max)
          .map((x) => x.idx),
      );
      group.forEach((c, idx) => chosen.has(idx) && out.push(c));
    }
    i = j;
  }
  return out;
}

/** Offsets for concatenating pages back-to-back: page k starts at the sum of earlier durations. */
export function concatOffsets(durations: number[], base = 0): number[] {
  const out: number[] = [];
  let acc = base;
  for (const d of durations) {
    out.push(acc);
    acc += d;
  }
  return out;
}

/** Offset so that Bilibili time `biliTime` lines up with YouTube time `ytTime`. */
export function offsetFromSyncPoint(ytTime: number, biliTime: number): number {
  return Math.round((ytTime - biliTime) * 10) / 10;
}
