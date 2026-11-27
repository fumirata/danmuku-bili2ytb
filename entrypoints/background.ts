import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { BiliError, fetchComments, resolveVideo } from '../src/bili/client';
import { parseBiliInput } from '../src/bili/input';
import type { RawComment } from '../src/core/types';
import { idbDelete, idbGet, idbPrune, idbPut } from '../src/idb';
import type { Reply, Request } from '../src/messaging';

/** Fetched Bilibili comments are kept for a day; local files until their source is removed. */
const CACHE_TTL = 24 * 60 * 60 * 1000;

interface CacheEntry {
  at: number;
  list: RawComment[];
}

async function cachedComments(cid: number, duration: number, fresh: boolean): Promise<RawComment[]> {
  if (!fresh) {
    const hit = await idbGet<CacheEntry>('comments', cid).catch(() => undefined);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.list;
  }
  const list = await fetchComments(cid, duration);
  await idbPut('comments', cid, { at: Date.now(), list } satisfies CacheEntry).catch((e) =>
    console.warn('[bili2ytb] cache write failed', e),
  );
  return list;
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'resolve': {
      const ref = parseBiliInput(req.input);
      if (!ref) throw new BiliError('无法识别的 B 站链接或 BV/av 号', 'other');
      return { ...(await resolveVideo(ref)), requestedPage: ref.page };
    }
    case 'comments':
      return cachedComments(req.cid, req.duration, req.fresh ?? false);
    case 'putFile':
      await idbPut('files', req.id, req.comments);
      return null;
    case 'getFile': {
      const list = await idbGet<RawComment[]>('files', req.id);
      if (!list) throw new BiliError('本地弹幕文件数据已丢失，请删除后重新导入', 'notfound');
      return list;
    }
    case 'deleteFile':
      await idbDelete('files', req.id);
      return null;
  }
}

export default defineBackground(() => {
  void idbPrune<CacheEntry>('comments', (e) => Date.now() - e.at > CACHE_TTL).catch(() => {});

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handle(msg as Request).then(
      (data) => sendResponse({ ok: true, data } satisfies Reply<unknown>),
      (e: unknown) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          kind: e instanceof BiliError ? e.kind : 'other',
        } satisfies Reply<unknown>),
    );
    return true;
  });
});
