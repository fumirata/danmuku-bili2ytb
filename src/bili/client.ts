import type { RawComment } from '../core/types';
import type { BiliRef } from './input';
import { parseSeg, parseXml } from './parse';
import { mixinKey, signQuery } from './wbi';

export type BiliErrorKind = 'risk' | 'notfound' | 'network' | 'other';

export class BiliError extends Error {
  constructor(
    message: string,
    public kind: BiliErrorKind,
  ) {
    super(message);
  }
}

export interface BiliPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

export interface VideoInfo {
  bvid: string;
  aid: number;
  title: string;
  pages: BiliPage[];
  /** page given via `?p=` in the user's input */
  requestedPage?: number;
}

const API = 'https://api.bilibili.com';
const SEGMENT_SECONDS = 360;

async function request(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch (e) {
    throw new BiliError(`网络错误：${(e as Error).message}`, 'network');
  }
  if (res.status === 412) throw new BiliError('被 B 站风控拦截（412），请在浏览器中登录 B 站后重试', 'risk');
  if (!res.ok) throw new BiliError(`B 站返回 HTTP ${res.status}`, 'other');
  return res;
}

async function getJson<T>(url: string): Promise<T> {
  const j = (await (await request(url)).json()) as { code: number; message: string; data: T };
  if (j.code === 0) return j.data;
  if (j.code === -412 || j.code === -352) throw new BiliError('被 B 站风控拦截，请在浏览器中登录 B 站后重试', 'risk');
  if (j.code === -404 || j.code === 62002 || j.code === 62004)
    throw new BiliError('视频不存在或不可见', 'notfound');
  throw new BiliError(`B 站接口错误 ${j.code}：${j.message}`, 'other');
}

export async function resolveVideo(ref: BiliRef): Promise<VideoInfo> {
  const q = ref.bvid ? `bvid=${encodeURIComponent(ref.bvid)}` : `aid=${ref.aid}`;
  const d = await getJson<{
    bvid: string;
    aid: number;
    title: string;
    pages: { cid: number; page: number; part: string; duration: number }[];
  }>(`${API}/x/web-interface/view?${q}`);
  return {
    bvid: d.bvid,
    aid: d.aid,
    title: d.title,
    pages: d.pages.map((p) => ({ cid: p.cid, page: p.page, part: p.part, duration: p.duration })),
  };
}

async function fetchSegment(cid: number, index: number): Promise<RawComment[]> {
  const res = await request(`${API}/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=${index}`);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    const j = (await res.json()) as { code: number; message: string };
    throw new BiliError(`seg.so 错误 ${j.code}：${j.message}`, j.code === -412 ? 'risk' : 'other');
  }
  return parseSeg(new Uint8Array(await res.arrayBuffer()));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Fetches all comments of one page: protobuf segments first, XML as fallback. */
export async function fetchComments(cid: number, duration: number): Promise<RawComment[]> {
  const count = Math.max(1, Math.ceil(duration / SEGMENT_SECONDS));
  const indexes = Array.from({ length: count }, (_, i) => i + 1);
  try {
    const parts = await mapLimit(indexes, 3, (i) => fetchSegment(cid, i));
    const all = parts.flat();
    if (all.length > 0) return all;
  } catch (e) {
    console.warn('[bili2ytb] seg.so failed, falling back to XML', e);
  }
  const xml = await (await request(`${API}/x/v1/dm/list.so?oid=${cid}`)).text();
  return parseXml(xml);
}

export interface SearchHit {
  bvid: string;
  title: string;
  author: string;
  /** seconds */
  duration: number;
  pic: string;
  play: number;
  danmaku: number;
  /** unix seconds */
  pubdate: number;
}

export interface SearchResult {
  hits: SearchHit[];
  page: number;
  numPages: number;
}

let wbiKey: { key: string; day: string } | null = null;

/** WBI keys rotate daily; cache for the day and refetch after a failure. */
async function getWbiKey(refresh = false): Promise<string> {
  const day = new Date().toDateString();
  if (!refresh && wbiKey?.day === day) return wbiKey.key;
  const j = (await (await request(`${API}/x/web-interface/nav`)).json()) as {
    data?: { wbi_img?: { img_url: string; sub_url: string } };
  };
  const img = j.data?.wbi_img;
  if (!img) throw new BiliError('获取 B 站签名密钥失败', 'other');
  wbiKey = { key: mixinKey(img.img_url, img.sub_url), day };
  return wbiKey.key;
}

/** Strips the `<em class="keyword">` highlight tags and decodes entities in search titles. */
export function cleanTitle(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&(lt|gt|amp|quot|#39|apos);/g, (_, e: string) =>
      ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", apos: "'" })[e] ?? '',
    );
}

/** "1:02:03" / "12:50" → seconds */
function parseDuration(s: string | number): number {
  if (typeof s === 'number') return s;
  return s.split(':').reduce((acc, p) => acc * 60 + (Number(p) || 0), 0);
}

interface RawHit {
  type?: string;
  bvid: string;
  title: string;
  author: string;
  duration: string | number;
  pic: string;
  play: number;
  danmaku?: number;
  video_review?: number;
  pubdate: number;
}

export async function searchVideos(keyword: string, page = 1): Promise<SearchResult> {
  const run = async (refresh: boolean) => {
    const key = await getWbiKey(refresh);
    const q = signQuery({ search_type: 'video', keyword, page }, key);
    return getJson<{ result?: RawHit[]; page?: number; numPages?: number; v_voucher?: string }>(
      `${API}/x/web-interface/wbi/search/type?${q}`,
    );
  };
  let d = await run(false);
  if (!d.result && d.v_voucher) d = await run(true);
  if (!d.result && d.v_voucher) throw new BiliError('搜索被 B 站风控拦截，请在浏览器中登录 B 站后重试', 'risk');
  const hits = (d.result ?? [])
    .filter((r) => (r.type ?? 'video') === 'video' && r.bvid)
    .map((r) => ({
      bvid: r.bvid,
      title: cleanTitle(r.title),
      author: r.author,
      duration: parseDuration(r.duration),
      pic: r.pic.startsWith('//') ? `https:${r.pic}` : r.pic,
      play: r.play,
      danmaku: r.danmaku ?? r.video_review ?? 0,
      pubdate: r.pubdate,
    }));
  return { hits, page: d.page ?? page, numPages: d.numPages ?? 1 };
}
