import { parseDanmakuFile } from '../../src/bili/parse';
import { concatOffsets, mergeComments } from '../../src/core/merge';
import type { RawComment, Settings, Source } from '../../src/core/types';
import { send } from '../../src/messaging';
import { loadBinding, saveBinding, saveSettings } from '../../src/storage';
import { Overlay } from './overlay';
import { Panel, type SourceStatus } from './panel';
import type { PlayerEls } from './player';

/** Everything for one YouTube video: its bound sources, fetched comments, overlay and panel. */
export class Session {
  private sources: Source[] = [];
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
      addFile: (file) => this.addFile(file),
      retry: (id) => this.load(this.sources.find((s) => s.id === id), true),
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
    this.sources = await loadBinding(this.ytId);
    if (this.dead) return;
    this.render();
    await Promise.all(this.sources.map((s) => this.load(s)));
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
    const mergeKeys: (keyof Settings)[] = ['blockModes', 'blockKeywords', 'dedupe', 'dedupeWindow', 'maxPerSecond'];
    if (mergeKeys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))) this.remerge();
    else this.render();
  }

  private async load(s: Source | undefined, fresh = false) {
    if (!s) return;
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
    const added: Source[] = [];
    pages.forEach((p, i) => {
      const id = `${info.bvid}-p${p.page}`;
      if (this.sources.some((s) => s.id === id)) return;
      const multi = info.pages.length > 1;
      added.push({
        id,
        bvid: info.bvid,
        cid: p.cid,
        page: p.page,
        title: multi ? `${info.title} · P${p.page} ${p.part}` : info.title,
        duration: p.duration,
        offset: offsets[i]!,
        enabled: true,
      });
    });
    if (!added.length) throw new Error('这个视频已经添加过了');
    this.sources.push(...added);
    await saveBinding(this.ytId, this.sources);
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
    const s: Source = {
      id,
      kind: 'file',
      bvid: '',
      cid: 0,
      page: 0,
      title: file.name,
      duration,
      offset: 0,
      enabled: true,
    };
    this.sources.push(s);
    this.comments.set(id, list);
    this.status.set(id, { state: 'ok', count: list.length });
    await saveBinding(this.ytId, this.sources);
    this.remerge(true);
    return `已导入 ${list.length} 条弹幕`;
  }

  private update(id: string, patch: Partial<Source>) {
    const s = this.sources.find((x) => x.id === id);
    if (!s) return;
    Object.assign(s, patch);
    void saveBinding(this.ytId, this.sources);
    this.remerge();
  }

  private remove(id: string) {
    const s = this.sources.find((x) => x.id === id);
    if (s?.kind === 'file') void send({ type: 'deleteFile', id }).catch(() => {});
    this.sources = this.sources.filter((x) => x.id !== id);
    this.comments.delete(id);
    this.status.delete(id);
    void saveBinding(this.ytId, this.sources);
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
