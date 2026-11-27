import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBiliInput } from '../src/bili/input';
import { parseSeg, parseXml } from '../src/bili/parse';

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

describe('parseXml', () => {
  it('parses the list.so fixture', () => {
    const list = parseXml(readFileSync(fixture('list.xml'), 'utf8'));
    expect(list.length).toBeGreaterThan(1000);
    const first = list[0]!;
    expect(first.time).toBeCloseTo(0.601, 3);
    expect(first.mode).toBe('bottom');
    expect(first.text).toContain('点赞');
    for (const c of list) {
      expect(c.time).toBeGreaterThanOrEqual(0);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it('decodes entities and skips advanced modes', () => {
    const xml =
      '<i><d p="1.5,1,25,16777215,0,0,a,1,5">a &amp; b &lt;3 &#x4F60;</d>' +
      '<d p="2,7,25,0,0,0,a,2,0">[advanced]</d><d p="3,6,18,255,0,0,a,3,0">x</d></i>';
    const list = parseXml(xml);
    expect(list).toEqual([
      { time: 1.5, mode: 'rtl', size: 25, color: 16777215, text: 'a & b <3 你', weight: 5 },
      { time: 3, mode: 'ltr', size: 18, color: 255, text: 'x', weight: 0 },
    ]);
  });
});

describe('parseSeg', () => {
  it('parses the seg.so fixture', () => {
    const list = parseSeg(new Uint8Array(readFileSync(fixture('seg1.bin'))));
    expect(list.length).toBeGreaterThan(1000);
    for (const c of list) {
      expect(c.time).toBeGreaterThanOrEqual(0);
      expect(c.time).toBeLessThanOrEqual(360);
      expect(c.color).toBeLessThanOrEqual(0xffffff);
      expect(c.text.length).toBeGreaterThan(0);
    }
    // The XML fixture's first comment should also be in the segment.
    expect(list.some((c) => c.text.includes('我是一万个点赞'))).toBe(true);
  });
});

describe('parseBiliInput', () => {
  it.each([
    ['BV1GJ411x7h7', { bvid: 'BV1GJ411x7h7' }],
    ['https://www.bilibili.com/video/BV1GJ411x7h7/?p=3&t=10', { bvid: 'BV1GJ411x7h7', page: 3 }],
    ['av80433022', { aid: 80433022 }],
    ['https://www.bilibili.com/video/av80433022?p=2', { aid: 80433022, page: 2 }],
  ])('%s', (input, expected) => {
    expect(parseBiliInput(input)).toEqual(expected);
  });

  it('rejects garbage', () => {
    expect(parseBiliInput('hello')).toBeNull();
    expect(parseBiliInput('')).toBeNull();
  });
});
