import { describe, expect, it } from 'vitest';
import { buildFilter } from '../src/core/filter';
import {
  concatOffsets,
  type MergeSettings,
  mergeComments,
  normalizeText,
  offsetFromSyncPoint,
} from '../src/core/merge';
import type { RawComment, Source } from '../src/core/types';

const c = (time: number, text: string, extra: Partial<RawComment> = {}): RawComment => ({
  time,
  text,
  mode: 'rtl',
  size: 25,
  color: 0xffffff,
  weight: 0,
  ...extra,
});

const src = (id: string, offset = 0, enabled = true): Source => ({
  id,
  bvid: 'BV1xxxxxxxxx',
  cid: 1,
  page: 1,
  title: id,
  duration: 100,
  offset,
  enabled,
});

const base: MergeSettings = {
  blockModes: [],
  blockKeywords: [],
  dedupe: false,
  dedupeWindow: 3,
  maxPerSecond: 0,
};

describe('mergeComments', () => {
  it('applies per-source offsets, drops negative times, skips disabled sources, sorts', () => {
    const map = new Map([
      ['a', [c(1, 'a1'), c(5, 'a5')]],
      ['b', [c(1, 'b1'), c(3, 'b3')]],
      ['c', [c(0, 'c0')]],
    ]);
    const out = mergeComments([src('a', 10), src('b', -2), src('c', 0, false)], map, base);
    expect(out.map((x) => [x.time, x.text, x.sourceId])).toEqual([
      [1, 'b3', 'b'],
      [11, 'a1', 'a'],
      [15, 'a5', 'a'],
    ]);
  });

  it('dedupes similar texts across sources within the window', () => {
    const map = new Map([
      ['a', [c(1, '哈哈哈哈哈'), c(10, '哈哈哈')]],
      ['b', [c(2, ' 哈哈哈哈 ', { weight: 7 })]],
    ]);
    const out = mergeComments([src('a'), src('b')], map, { ...base, dedupe: true });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ time: 1, count: 2, weight: 7 });
    expect(out[1]).toMatchObject({ time: 10, count: 1 });
  });

  it('limits density per second preferring higher weight, keeping order', () => {
    const map = new Map([
      ['a', [c(1.0, 'x'), c(1.2, 'y', { weight: 9 }), c(1.5, 'z', { weight: 5 }), c(2.1, 'w')]],
    ]);
    const out = mergeComments([src('a')], map, { ...base, maxPerSecond: 2 });
    expect(out.map((x) => x.text)).toEqual(['y', 'z', 'w']);
  });

  it('applies keyword, regex and mode filters', () => {
    const map = new Map([
      ['a', [c(1, '前方高能'), c(2, 'AAA111'), c(3, 'ok'), c(4, 'top', { mode: 'top' })]],
    ]);
    const out = mergeComments([src('a')], map, {
      ...base,
      blockKeywords: ['高能', '/^a+\\d+$/i', '/[invalid/'],
      blockModes: ['top'],
    });
    expect(out.map((x) => x.text)).toEqual(['ok']);
  });
});

describe('helpers', () => {
  it('concatOffsets', () => {
    expect(concatOffsets([600, 600, 300])).toEqual([0, 600, 1200]);
    expect(concatOffsets([10, 20], 5)).toEqual([5, 15]);
  });
  it('offsetFromSyncPoint', () => {
    expect(offsetFromSyncPoint(75.04, 63)).toBe(12);
    expect(offsetFromSyncPoint(10, 22.37)).toBe(-12.4);
  });
  it('normalizeText', () => {
    expect(normalizeText('ＡＢ c')).toBe('abc');
    expect(normalizeText('233333')).toBe('2333');
  });
  it('buildFilter ignores blank keywords', () => {
    expect(buildFilter({ blockModes: [], blockKeywords: ['  '] })(c(0, 'x'))).toBe(true);
  });
});
