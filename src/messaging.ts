import { browser } from 'wxt/browser';
import type { BiliErrorKind, VideoInfo } from './bili/client';
import type { RawComment } from './core/types';

export type Request =
  | { type: 'resolve'; input: string }
  | { type: 'comments'; cid: number; duration: number; fresh?: boolean }
  | { type: 'putFile'; id: string; comments: RawComment[] }
  | { type: 'getFile'; id: string }
  | { type: 'deleteFile'; id: string };

export interface ResponseMap {
  resolve: VideoInfo;
  comments: RawComment[];
  putFile: null;
  getFile: RawComment[];
  deleteFile: null;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string; kind: BiliErrorKind };

export class RemoteError extends Error {
  constructor(
    message: string,
    public kind: BiliErrorKind,
  ) {
    super(message);
  }
}

/** Content script → background. */
export async function send<R extends Request>(req: R): Promise<ResponseMap[R['type']]> {
  if (!browser.runtime?.id) throw new RemoteError('扩展已更新或重新加载，请刷新页面', 'other');
  const reply = (await browser.runtime.sendMessage(req)) as Reply<ResponseMap[R['type']]> | undefined;
  if (!reply) throw new RemoteError('后台没有响应，请刷新页面重试', 'other');
  if (!reply.ok) throw new RemoteError(reply.error, reply.kind);
  return reply.data;
}
