export interface BiliRef {
  bvid?: string;
  aid?: number;
  /** 1-based page from `?p=`, if given */
  page?: number;
}

/** Accepts a BV id, av id, or any bilibili.com / b23-style video URL containing one. */
export function parseBiliInput(input: string): BiliRef | null {
  const s = input.trim();
  if (!s) return null;
  const bv = /(BV[0-9A-Za-z]{10})/.exec(s);
  const av = /(?:^|[^a-z])av(\d+)/i.exec(s);
  if (!bv && !av) return null;
  const ref: BiliRef = bv ? { bvid: bv[1] } : { aid: Number(av![1]) };
  const p = /[?&]p=(\d+)/.exec(s);
  if (p) ref.page = Number(p[1]);
  return ref;
}
