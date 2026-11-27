import { md5 } from './md5';

const MIXIN_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
];

const fileKey = (url: string) => url.slice(url.lastIndexOf('/') + 1).split('.')[0] ?? '';

/** Mixin key from the `wbi_img` URLs returned by `x/web-interface/nav`. */
export function mixinKey(imgUrl: string, subUrl: string): string {
  const raw = fileKey(imgUrl) + fileKey(subUrl);
  return MIXIN_TABLE.map((i) => raw[i] ?? '')
    .join('')
    .slice(0, 32);
}

/** Query string with `wts` and `w_rid` appended, as the WBI-protected endpoints expect. */
export function signQuery(params: Record<string, string | number>, key: string, wts = Math.floor(Date.now() / 1000)) {
  const all: Record<string, string | number> = { ...params, wts };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${md5(query + key)}`;
}
