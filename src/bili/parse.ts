import { biliMode, type RawComment } from '../core/types';

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

/** Parse the XML returned by `x/v1/dm/list.so` (or a saved .xml file). */
export function parseXml(xml: string): RawComment[] {
  const out: RawComment[] = [];
  const re = /<d\s+p="([^"]*)"\s*>([\s\S]*?)<\/d>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const p = m[1]!.split(',');
    const mode = biliMode(Number(p[1]));
    if (!mode) continue;
    const text = decodeEntities(m[2]!);
    if (!text) continue;
    out.push({
      time: Number(p[0]) || 0,
      mode,
      size: Number(p[2]) || 25,
      color: Number(p[3]) || 0xffffff,
      text,
      weight: Number(p[8]) || 0,
    });
  }
  return out;
}

/* ---------- ASS (e.g. made by danmaku2ass / biliass) ---------- */

function assTime(t: string): number | null {
  const m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t.trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** `&HBBGGRR&` or `&HAABBGGRR&` → 0xRRGGBB */
function assColor(c: string): number {
  const hex = c.replace(/[&H]/gi, '').padStart(6, '0').slice(-6);
  const bgr = parseInt(hex, 16);
  if (!Number.isFinite(bgr)) return 0xffffff;
  return ((bgr & 0xff) << 16) | (bgr & 0xff00) | ((bgr >> 16) & 0xff);
}

/**
 * Parses danmaku-style ASS subtitles. Mode is inferred from override tags:
 * `\move` → scrolling (direction from x), `\an7-9` → top, `\an1-3` → bottom, `\pos` alone → top.
 */
export function parseAss(text: string): RawComment[] {
  const lines = text.split(/\r?\n/);
  let playResY = 0;
  const styleSize = new Map<string, number>();
  const styleColor = new Map<string, number>();
  let styleFormat: string[] = [];
  let eventFormat: string[] = [];
  let section = '';
  const out: RawComment[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.+\]$/.test(line)) {
      section = line.toLowerCase();
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'playresy') playResY = Number(value) || 0;
    else if (key === 'format' && section.includes('styles')) styleFormat = value.split(',').map((s) => s.trim().toLowerCase());
    else if (key === 'format' && section === '[events]') eventFormat = value.split(',').map((s) => s.trim().toLowerCase());
    else if (key === 'style' && styleFormat.length) {
      const f = value.split(',');
      const name = f[styleFormat.indexOf('name')]?.trim() ?? '';
      const size = Number(f[styleFormat.indexOf('fontsize')]);
      if (size) styleSize.set(name, size);
      const col = f[styleFormat.indexOf('primarycolour')];
      if (col) styleColor.set(name, assColor(col));
    } else if (key === 'dialogue') {
      const fmt = eventFormat.length
        ? eventFormat
        : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const textIdx = fmt.indexOf('text');
      const parts = value.split(',');
      const fields = [...parts.slice(0, textIdx), parts.slice(textIdx).join(',')];
      const time = assTime(fields[fmt.indexOf('start')] ?? '');
      const body = fields[textIdx] ?? '';
      if (time === null) continue;
      const style = fields[fmt.indexOf('style')]?.trim() ?? '';
      const tags = (body.match(/\{[^}]*\}/g) ?? []).join('');
      const content = body.replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ').replace(/\\h/g, ' ').trim();
      if (!content) continue;

      let mode: RawComment['mode'] = 'rtl';
      const move = /\\move\(\s*(-?[\d.]+)\s*,\s*-?[\d.]+\s*,\s*(-?[\d.]+)/.exec(tags);
      const an = /\\an(\d)/.exec(tags);
      if (move) mode = Number(move[1]) < Number(move[2]) ? 'ltr' : 'rtl';
      else if (an) mode = Number(an[1]) <= 3 ? 'bottom' : 'top';
      else if (/\\pos\(/.test(tags)) mode = 'top';

      const fs = Number(/\\fs([\d.]+)/.exec(tags)?.[1]) || styleSize.get(style) || 25;
      const size = playResY ? Math.round((fs * 540) / playResY) : fs;
      const c = /\\1?c(&H[0-9a-f]+&?)/i.exec(tags);
      out.push({
        time,
        mode,
        size: Math.min(64, Math.max(12, size)),
        color: c ? assColor(c[1]!) : (styleColor.get(style) ?? 0xffffff),
        text: content,
        weight: 0,
      });
    }
  }
  return out;
}

/** Picks a parser by file name / content. */
export function parseDanmakuFile(name: string, text: string): RawComment[] {
  if (/\.ass$/i.test(name) || /^\s*\[Script Info\]/i.test(text)) return parseAss(text);
  if (/\.xml$/i.test(name) || /<d\s+p="/.test(text)) return parseXml(text);
  throw new Error('不支持的文件格式，仅支持 B 站 XML 弹幕或 ASS 字幕');
}

/* ---------- minimal protobuf reader for DmSegMobileReply ---------- */

class Reader {
  pos = 0;
  constructor(private buf: Uint8Array, start = 0, private end = buf.length) {
    this.pos = start;
  }
  get done() {
    return this.pos >= this.end;
  }
  /** Reads a varint as a JS number (exact up to 2^53). */
  varint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      const b = this.buf[this.pos++];
      if (b === undefined) throw new Error('protobuf: unexpected end');
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
    throw new Error('protobuf: varint too long');
  }
  bytes(): [number, number] {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new Error('protobuf: length out of range');
    return [start, this.pos];
  }
  skip(wireType: number) {
    switch (wireType) {
      case 0:
        this.varint();
        break;
      case 1:
        this.pos += 8;
        break;
      case 2:
        this.bytes();
        break;
      case 5:
        this.pos += 4;
        break;
      default:
        throw new Error(`protobuf: unsupported wire type ${wireType}`);
    }
  }
}

const utf8 = new TextDecoder();

/** Parse a `x/v2/dm/web/seg.so` response body. */
export function parseSeg(buf: Uint8Array): RawComment[] {
  const out: RawComment[] = [];
  const r = new Reader(buf);
  while (!r.done) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wt = tag & 7;
    if (field === 1 && wt === 2) {
      const [s, e] = r.bytes();
      const c = parseElem(buf, s, e);
      if (c) out.push(c);
    } else {
      r.skip(wt);
    }
  }
  return out;
}

function parseElem(buf: Uint8Array, start: number, end: number): RawComment | null {
  const r = new Reader(buf, start, end);
  let progress = 0;
  let mode = 1;
  let size = 25;
  let color = 0xffffff;
  let text = '';
  let weight = 0;
  while (!r.done) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wt = tag & 7;
    if (wt === 0 && field >= 2 && field <= 9 && field !== 6 && field !== 7) {
      const v = r.varint();
      if (field === 2) progress = v;
      else if (field === 3) mode = v;
      else if (field === 4) size = v;
      else if (field === 5) color = v;
      else if (field === 9) weight = v;
    } else if (field === 7 && wt === 2) {
      const [s, e] = r.bytes();
      text = utf8.decode(buf.subarray(s, e));
    } else {
      r.skip(wt);
    }
  }
  const m = biliMode(mode);
  if (!m || !text) return null;
  return { time: progress / 1000, mode: m, size, color, text, weight };
}
