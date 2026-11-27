import type { RawComment, Settings } from './types';

export type CommentPredicate = (c: RawComment) => boolean;

/** Turns a keyword list into matchers. `/expr/flags` entries are regexes; invalid ones are ignored. */
export function compileKeywords(list: string[]): ((text: string) => boolean)[] {
  const out: ((text: string) => boolean)[] = [];
  for (const raw of list) {
    const k = raw.trim();
    if (!k) continue;
    const re = /^\/(.+)\/([a-z]*)$/i.exec(k);
    if (re) {
      try {
        const rx = new RegExp(re[1]!, re[2]!.replace(/[gy]/g, ''));
        out.push((t) => rx.test(t));
      } catch {
        /* invalid regex: skip */
      }
    } else {
      const lower = k.toLowerCase();
      out.push((t) => t.toLowerCase().includes(lower));
    }
  }
  return out;
}

/** Returns a predicate that is true for comments that should be KEPT. */
export function buildFilter(settings: Pick<Settings, 'blockModes' | 'blockKeywords'>): CommentPredicate {
  const modes = new Set(settings.blockModes);
  const kws = compileKeywords(settings.blockKeywords);
  return (c) => !modes.has(c.mode) && !kws.some((f) => f(c.text));
}
