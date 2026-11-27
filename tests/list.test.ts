import { describe, expect, it } from 'vitest';
import { buildList, LIST_FORMAT, parseList } from '../src/core/list';
import type { Source } from '../src/core/types';

const src = (p: Partial<Source>): Source => ({
  id: 'x',
  bvid: 'BV1AXpc6KEMc',
  cid: 1,
  page: 1,
  title: 't',
  duration: 100,
  offset: 0,
  enabled: true,
  ...p,
});

describe('parseList', () => {
  it('rejects non-lists', () => {
    expect(() => parseList(null)).toThrow();
    expect(() => parseList({ entries: {} })).toThrow(/格式/);
    expect(() => parseList({ format: LIST_FORMAT })).toThrow(/entries/);
    expect(() => parseList({ format: LIST_FORMAT, entries: [] })).toThrow(/entries/);
  });

  it('keeps valid entries and drops bad ones', () => {
    const l = parseList({
      format: LIST_FORMAT,
      name: '  测试  ',
      homepage: 'javascript:alert(1)',
      entries: {
        ujkD4SxPKOI: [
          { bvid: 'BV1AXpc6KEMc', page: 1, offset: -2.34 },
          { bvid: 'BV1AXpc6KEMc', page: 1, offset: 5 }, // duplicate page
          { bvid: 'BV1AXpc6KEMc', page: 2 }, // offset defaults to 0
          { bvid: 'nope', page: 1, offset: 0 },
          { bvid: 'BV1AXpc6KEMc', page: 0, offset: 0 },
          { bvid: 'BV1AXpc6KEMc', page: 3, offset: 'x' },
        ],
        short: [{ bvid: 'BV1AXpc6KEMc', page: 1, offset: 0 }],
        aaaaaaaaaaa: 'not an array',
        bbbbbbbbbbb: [{ bvid: 'bad' }],
      },
    });
    expect(l.name).toBe('测试');
    expect(l.homepage).toBeUndefined();
    expect(l.entries).toEqual({
      ujkD4SxPKOI: [
        { bvid: 'BV1AXpc6KEMc', page: 1, offset: -2.3 },
        { bvid: 'BV1AXpc6KEMc', page: 2, offset: 0 },
      ],
    });
  });

  it('caps entries per video', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ bvid: 'BV1AXpc6KEMc', page: i + 1, offset: 0 }));
    expect(parseList({ format: LIST_FORMAT, entries: { ujkD4SxPKOI: many } }).entries.ujkD4SxPKOI).toHaveLength(10);
  });
});

describe('buildList', () => {
  it('exports overrides but not disabled ones', () => {
    const built = buildList(
      {
        ujkD4SxPKOI: [
          src({ from: 'https://a/list.json', offset: 3 }),
          src({ page: 2, from: 'https://a/list.json', enabled: false }),
        ],
      },
      { name: 'x' },
    );
    expect(built.entries).toEqual({ ujkD4SxPKOI: [{ bvid: 'BV1AXpc6KEMc', page: 1, offset: 3 }] });
  });

  it('skips local files and round-trips', () => {
    const built = buildList(
      {
        ujkD4SxPKOI: [src({ page: 2, offset: 12.5 }), src({ kind: 'file', bvid: '', id: 'file-1' })],
        onlyFile123: [src({ kind: 'file', bvid: '' })],
      },
      { name: '我的表' },
      new Date('2026-11-27T00:00:00Z'),
    );
    expect(built).toEqual({
      format: LIST_FORMAT,
      name: '我的表',
      updated: '2026-11-27T00:00:00.000Z',
      entries: { ujkD4SxPKOI: [{ bvid: 'BV1AXpc6KEMc', page: 2, offset: 12.5 }] },
    });
    const { format: _f, ...rest } = built;
    expect(parseList(JSON.parse(JSON.stringify(built)))).toEqual(rest);
  });
});
