import type { BiliPage, VideoInfo } from '../../src/bili/client';
import { parseDanmakuFile } from '../../src/bili/parse';
import { concatOffsets, mergeComments } from '../../src/core/merge';
import type { RawComment, Settings, Source, SourceList } from '../../src/core/types';
import type { ListSuggestion } from '../../src/lists';
import { send } from '../../src/messaging';
import { loadBinding, saveBinding, saveSettings } from '../../src/storage';
import { Overlay } from './overlay';
import { Panel, type SourceStatus } from './panel';
import type { PlayerEls } from './player';

const pageId = (bvid: string, page: number) => `${bvid}-p${page}`;

function sourceFor(info: VideoInfo, p: BiliPage, offset: number): Source {
  const multi = info.pages.length > 1;
  return {
    id: pageId(info.bvid, p.page),
    bvid: info.bvid,
    cid: p.cid,
    page: p.page,
    title: multi ? `${info.title} · P${p.page} ${p.part}` : info.title,
    duration: p.duration,
    offset,
    enabled: true,
  };
}

/** Strips runtime-only fields before saving. */
function persistable({ list: _list, ...s }: Source): Source {
  return s;
}

/**
 * Everything for one YouTube video. The sources shown and merged are the user's own sources plus the
 * entries of subscribed lists, read live each time the video opens. An own source with the same page id
 * as a list entry overrides it (offset, enabled); removing that override goes back to the list.
 */
export class Session {
  /** saved in storage.local */
  private own: Source[] = [];
  /** resolved from subscribed lists, highest priority first */
  private live: Source[] = [];
  /** what is shown and merged */
  private sources: Source[] = [];
  private suggestions: ListSuggestion[] = [];
  private comments = new Map<string, RawComment[]>();
  private status = new Map<string, SourceStatus>();
  private overlay: Overlay;
  private panel: Panel;
  private mergeTimer = 0;
  private dead = false;

  constructor(
    private ytId: string,
    private els: PlayerEls,
    private settings: Settings,
  ) {
    this.overlay = new Overlay(els.player, els.video, settings);
    this.panel = new Panel(els.player, {
      add: (input, concatAll) => this.add(input, concatAll),
      update: (id, patch) => this.update(id, patch),
      remove: (id) => this.remove(id),
      restore: (id) => this.restore(id),
      addFile: (file) => this.addFile(file),
      retry: (id) => this.retry(id),
      setEnabled: (on) => void saveSettings({ enabled: on }),
      currentTime: () => els.video.currentTime,
      search: (keyword, page) => send({ type: 'search', keyword, page }),
      videoTitle: () =>
        document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() ||
        document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, ''),
    });
  }

  get player() {
    return this.els.player;
  }

  async start() {
    const [own, suggestions] = await Promise.all([
      loadBinding(this.ytId),
      send({ type: 'lookupLists', ytId: this.ytId }).catch((e: unknown) => {
        console.warn('[bili2ytb] list lookup failed', e);
        return [] as ListSuggestion[];
      }),
    ]);
    if (this.dead) return;
    this.own = own;
    this.suggestions = suggestions;
    this.rebuild();
    this.render();
    await Promise.all([...this.own.map((s) => this.load(s)), this.loadLive()]);
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.mergeTimer);
    this.overlay.destroy();
    this.panel.destroy();
  }

  applySettings(next: Settings) {
    const prev = this.settings;
    this.settings = next;
    this.overlay.setSettings(next);
    const mergeKeys: (keyof Settings)[] = ['blockModes', 'blockKeywords', 'dedupe', 'dedupeWindow', 'maxPerSecond', 'weightLevel'];
    if (mergeKeys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))) this.remerge();
    else this.render();
  }

  /** Own sources first, then list entries no own source replaces. */
  private rebuild() {
    const liveById = new Map(this.live.map((s) => [s.id, s]));
    const ownIds = new Set(this.own.map((s) => s.id));
    this.sources = [
      ...this.own.map((s) => {
        const l = liveById.get(s.id)?.list;
        return l ? { ...s, list: { ...l, overridden: true } } : s;
      }),
      ...this.live.filter((s) => !ownIds.has(s.id)),
    ];
  }

  /** Resolves every subscribed entry for this video (title, cid, duration) and loads its comments. */
  private async loadLive() {
    const picked = new Map<string, { bvid: string; page: number; list: SourceList }>();
    for (const l of this.suggestions)
      for (const e of l.entries) {
        const id = pageId(e.bvid, e.page);
        const first = picked.get(id);
        if (first) first.list.others.push({ name: l.name, offset: e.offset });
        else
          picked.set(id, {
            bvid: e.bvid,
            page: e.page,
            list: { url: l.url, name: l.name, offset: e.offset, others: [], overridden: false },
          });
      }
    if (!picked.size) return;

    const infos = new Map<string, Promise<VideoInfo>>();
    for (const p of picked.values())
      if (!infos.has(p.bvid)) infos.set(p.bvid, send({ type: 'resolve', input: p.bvid }));

    const live: Source[] = [];
    const failed = new Map<string, string>();
    for (const [id, p] of picked) {
      try {
        const info = await infos.get(p.bvid)!;
        const page = info.pages.find((x) => x.page === p.page);
        if (!page) throw new Error(`该视频没有 P${p.page}`);
        live.push({ ...sourceFor(info, page, p.list.offset), list: p.list });
      } catch (e) {
        // keep a placeholder row so the user sees the failure and can retry
        live.push({
          id,
          bvid: p.bvid,
          cid: 0,
          page: p.page,
          title: `${p.bvid} P${p.page}`,
          duration: 0,
          offset: p.list.offset,
          enabled: true,
          list: p.list,
        });
        failed.set(id, `订阅来源解析失败：${(e as Error).message}`);
      }
    }
    if (this.dead) return;
    this.live = live;
    this.rebuild();
    for (const [id, error] of failed) this.status.set(id, { state: 'error', error });
    // Comments for overridden entries are already loading through the own source (same id).
    const ownIds = new Set(this.own.map((s) => s.id));
    this.render();
    await Promise.all(live.filter((s) => s.cid && !ownIds.has(s.id)).map((s) => this.load(s)));
  }

  private async load(s: Source | undefined, fresh = false) {
    if (!s) return;
    if (s.kind !== 'file' && !s.cid) return; // unresolved list entry
    this.status.set(s.id, { state: 'loading' });
    this.render();
    try {
      const list =
        s.kind === 'file'
          ? await send({ type: 'getFile', id: s.id })
          : await send({ type: 'comments', cid: s.cid, duration: s.duration, fresh });
      if (this.dead) return;
      this.comments.set(s.id, list);
      this.status.set(s.id, { state: 'ok', count: list.length });
      this.remerge(true);
    } catch (e) {
      if (this.dead) return;
      this.status.set(s.id, { state: 'error', error: (e as Error).message });
      this.render();
    }
  }

  private retry(id: string) {
    const s = this.sources.find((x) => x.id === id);
    if (s && s.kind !== 'file' && !s.cid && s.list) void this.loadLive();
    else void this.load(s, true);
  }

  private async add(input: string, concatAll: boolean): Promise<string | void> {
    const info = await send({ type: 'resolve', input });
    let pages = info.pages;
    let note: string | undefined;
    if (info.requestedPage) {
      pages = pages.filter((p) => p.page === info.requestedPage);
      if (!pages.length) throw new Error(`该视频没有 P${info.requestedPage}`);
    } else if (!concatAll && pages.length > 1) {
      pages = pages.slice(0, 1);
      note = `该视频共有 ${info.pages.length} 个分P，已添加 P1。勾选"全部分P按顺序拼接"可一次添加全部。`;
    }
    const offsets = concatOffsets(pages.map((p) => p.duration));
    const added = pages
      .map((p, i) => sourceFor(info, p, offsets[i]!))
      .filter((s) => !this.sources.some((x) => x.id === s.id));
    if (!added.length) throw new Error('这个视频已经添加过了（可能来自订阅）');
    this.own.push(...added);
    await this.save();
    this.rebuild();
    this.render();
    void Promise.all(added.map((s) => this.load(s)));
    return note ?? `已添加 ${added.length} 个来源`;
  }

  private async addFile(file: File): Promise<string> {
    const list = parseDanmakuFile(file.name, await file.text());
    if (!list.length) throw new Error('文件里没有可用的弹幕');
    const id = `file-${Date.now().toString(36)}`;
    await send({ type: 'putFile', id, comments: list });
    const duration = Math.ceil(list.reduce((m, c) => Math.max(m, c.time), 0));
    this.own.push({ id, kind: 'file', bvid: '', cid: 0, page: 0, title: file.name, duration, offset: 0, enabled: true });
    this.comments.set(id, list);
    this.status.set(id, { state: 'ok', count: list.length });
    await this.save();
    this.rebuild();
    this.remerge(true);
    return `已导入 ${list.length} 条弹幕`;
  }

  private save() {
    return saveBinding(this.ytId, this.own.map(persistable));
  }

  /** Changing a list entry turns it into an own override of that entry. */
  private update(id: string, patch: Partial<Source>) {
    let s = this.own.find((x) => x.id === id);
    if (!s) {
      const l = this.live.find((x) => x.id === id);
      if (!l?.list) return;
      s = { ...persistable(l), from: l.list.url };
      this.own.push(s);
    }
    Object.assign(s, patch);
    void this.save();
    this.rebuild();
    this.remerge();
  }

  /** Drops the own override so the list's entry applies again. */
  private restore(id: string) {
    this.own = this.own.filter((x) => x.id !== id);
    void this.save();
    this.rebuild();
    this.remerge(true);
  }

  private remove(id: string) {
    const s = this.own.find((x) => x.id === id);
    if (!s) return; // list entries can only be disabled
    if (s.kind === 'file') void send({ type: 'deleteFile', id }).catch(() => {});
    this.own = this.own.filter((x) => x.id !== id);
    if (!this.live.some((x) => x.id === id)) {
      this.comments.delete(id);
      this.status.delete(id);
    }
    void this.save();
    this.rebuild();
    this.remerge(true);
  }

  /** Debounced so rapid offset nudges don't rebuild the renderer every click. */
  private remerge(immediate = false) {
    this.render();
    clearTimeout(this.mergeTimer);
    const run = () => {
      if (this.dead) return;
      const placed = mergeComments(this.sources, this.comments, this.settings);
      this.overlay.setComments(placed);
      this.render(placed.length);
    };
    if (immediate) run();
    else this.mergeTimer = window.setTimeout(run, 250);
  }

  private lastShown = 0;
  private render(shown?: number) {
    if (shown !== undefined) this.lastShown = shown;
    let total = 0;
    for (const s of this.sources) if (s.enabled) total += this.comments.get(s.id)?.length ?? 0;
    this.panel.render({
      enabled: this.settings.enabled,
      sources: this.sources,
      status: this.status,
      shownCount: this.lastShown,
      totalCount: total,
    });
  }
}
