import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cleanTitle } from '../src/bili/client';
import { md5 } from '../src/bili/md5';
import { mixinKey, signQuery } from '../src/bili/wbi';

describe('md5', () => {
  it('matches node crypto', () => {
    for (const s of ['', 'a', 'abc', '原神 弹幕', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)])
      expect(md5(s)).toBe(createHash('md5').update(s).digest('hex'));
  });
});

describe('wbi', () => {
  // example from the community API docs (bilibili-API-collect)
  const key = mixinKey(
    'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
    'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
  );
  it('derives the mixin key', () => expect(key).toBe('ea1db124af3c7062474693fa704f4ff8'));
  it('signs sorted params', () => {
    expect(signQuery({ foo: '114', bar: '514', zab: 1919810 }, key, 1702204169)).toBe(
      'bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4',
    );
  });
  it('drops !\'()* and encodes values', () => {
    const q = signQuery({ keyword: "a(b)!c 原" }, key, 1);
    expect(q.startsWith('keyword=abc%20%E5%8E%9F&wts=1&w_rid=')).toBe(true);
  });
});

describe('cleanTitle', () => {
  it('strips highlight tags and entities', () => {
    expect(cleanTitle('<em class="keyword">进击</em>的巨人 &amp; &quot;x&quot;')).toBe('进击的巨人 & "x"');
  });
});
