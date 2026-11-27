import type { SearchHit, SearchResult } from '../../src/bili/client';
import { parseBiliInput } from '../../src/bili/input';
import type { Source } from '../../src/core/types';
import { h } from './dom';
import { findControlsBar, formatTime, parseTime } from './player';

export interface SourceStatus {
  state: 'loading' | 'ok' | 'error';
  count?: number;
  error?: string;
}

export interface PanelState {
  enabled: boolean;
  sources: Source[];
  status: Map<string, SourceStatus>;
  shownCount: number;
  totalCount: number;
}

export interface PanelActions {
  add(input: string, concatAll: boolean): Promise<string | void>;
  addFile(file: File): Promise<string>;
  update(id: string, patch: Partial<Source>): void;
  remove(id: string): void;
  /** drop the own override of a subscribed entry */
  restore(id: string): void;
  retry(id: string): void;
  setEnabled(on: boolean): void;
  currentTime(): number;
  search(keyword: string, page: number): Promise<SearchResult>;
  /** title of the current YouTube video, used when searching with an empty box */
  videoTitle(): string;
}

const CSS = `
:host { all: initial; }
.panel { position: absolute; top: 12px; right: 12px; width: 420px; max-height: calc(100% - 80px);
  overflow: auto; background: rgba(20,20,20,.94); color: #eee; border-radius: 10px; padding: 12px;
  font: 13px/1.45 "PingFang SC","Microsoft YaHei",Roboto,sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
.panel[hidden] { display: none; }
.row { display: flex; align-items: center; gap: 6px; }
.between { justify-content: space-between; }
h3 { margin: 0; font-size: 15px; color: #fb7299; }
input[type=text] { flex: 1; min-width: 0; background: #2b2b2b; border: 1px solid #444; color: #eee;
  border-radius: 6px; padding: 5px 8px; font: inherit; }
input.off { width: 52px; flex: none; text-align: center; padding: 3px 4px; }
button { background: #333; color: #eee; border: 1px solid #555; border-radius: 6px; padding: 3px 8px;
  font: inherit; cursor: pointer; }
button:hover { background: #444; }
button.primary { background: #fb7299; border-color: #fb7299; color: #fff; }
button.small { padding: 1px 5px; font-size: 12px; }
button.link { background: none; border: none; color: #8ab4f8; padding: 0 2px; }
.x { background: none; border: none; font-size: 18px; line-height: 1; color: #aaa; }
.section { margin-top: 10px; }
.msg { margin-top: 6px; color: #f6b26b; white-space: pre-wrap; }
.msg.ok { color: #8bd48b; }
.src { border-top: 1px solid #333; padding: 8px 0; }
.title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: #999; font-size: 12px; }
.err { color: #f28b82; font-size: 12px; }
.badge { color: #7cc4ff; }
.sync { margin-top: 6px; padding: 6px; background: #262626; border-radius: 6px; }
.foot { margin-top: 8px; color: #999; font-size: 12px; }
.results { margin-top: 8px; border-top: 1px solid #333; }
.hit { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid #2a2a2a; }
.hit img { width: 96px; height: 54px; object-fit: cover; border-radius: 4px; background: #333; flex: none; }
.hit .body { flex: 1; min-width: 0; }
.hit .t { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: #eee;
  text-decoration: none; }
.hit .t:hover { color: #fb7299; }
.hit button { align-self: center; flex: none; }
.pager { margin-top: 6px; color: #999; font-size: 12px; }
label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
`;

const STOP = ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup', 'wheel', 'contextmenu'];

/** Floating control panel inside the player (so it also works in fullscreen) plus a toolbar toggle button. */
export class Panel {
  private host: HTMLDivElement;
  private panel: HTMLDivElement;
  private list: HTMLDivElement;
  private foot: HTMLDivElement;
  private enabledBox: HTMLInputElement;
  private msg: HTMLDivElement;
  private button: HTMLElement;
  private syncFor: { id: string; ytTime: number } | null = null;
  private state: PanelState | null = null;
  private results: HTMLDivElement;
  private search: { keyword: string; result: SearchResult } | null = null;
  private concat: HTMLInputElement;

  constructor(
    private player: HTMLElement,
    private actions: PanelActions,
  ) {
    this.host = h('div', { class: 'bili2ytb-panel-host' });
    this.host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:70;';
    for (const t of STOP) this.host.addEventListener(t, (e) => e.stopPropagation());
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;

    const input = h('input', { type: 'text', placeholder: 'B站链接 / BV号 / 搜索关键词' });
    const concat = (this.concat = h('input', { type: 'checkbox' }));
    this.results = h('div', { class: 'results', hidden: true });
    this.msg = h('div', { class: 'msg' });
    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      this.setMsg('解析中…', true);
      try {
        const note = await actions.add(value, concat.checked);
        input.value = '';
        this.setMsg(note ?? '已添加', true);
      } catch (e) {
        this.setMsg((e as Error).message);
      }
    };
    const search = () => {
      const keyword = input.value.trim() || actions.videoTitle();
      if (!keyword) return this.setMsg('请输入搜索关键词');
      input.value = keyword;
      void this.runSearch(keyword, 1);
    };
    // Enter adds when the text is a link / BV / av id, otherwise searches.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (parseBiliInput(input.value)) void submit();
      else search();
    });

    const fileInput = h('input', { type: 'file', accept: '.xml,.ass', hidden: true });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      this.setMsg(`读取 ${f.name}…`, true);
      try {
        this.setMsg(await actions.addFile(f), true);
      } catch (e) {
        this.setMsg((e as Error).message);
      }
    });

    this.enabledBox = h('input', {
      type: 'checkbox',
      onchange: () => actions.setEnabled(this.enabledBox.checked),
    });
    this.list = h('div', { class: 'section' });
    this.foot = h('div', { class: 'foot' });

    this.panel = h(
      'div',
      { class: 'panel', hidden: true },
      h(
        'div',
        { class: 'row between' },
        h('h3', {}, 'B站弹幕'),
        h(
          'div',
          { class: 'row' },
          h('label', {}, this.enabledBox, '显示弹幕'),
          h('button', { class: 'x', title: '关闭', onclick: () => this.toggle(false) }, '×'),
        ),
      ),
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'row' }, input, h('button', { class: 'primary', onclick: submit }, '添加'),
          h('button', { title: '在 B 站搜索；输入框为空时搜索当前 YouTube 视频标题', onclick: search }, '搜索'),
        ),
        h(
          'div',
          { class: 'row between', style: 'margin-top:6px' },
          h('label', {}, concat, '多P视频：全部分P按顺序拼接'),
          h(
            'button',
            { class: 'small', title: '导入 B 站 XML 弹幕或 ASS 字幕文件', onclick: () => fileInput.click() },
            '导入文件',
          ),
          fileInput,
        ),
        this.msg,
        this.results,
      ),
      this.list,
      this.foot,
    );
    this.panel.style.pointerEvents = 'auto';
    shadow.append(style, this.panel);
    player.appendChild(this.host);

    this.button = this.makeButton();
  }

  private makeButton(): HTMLElement {
    const bar = findControlsBar(this.player);
    const btn = h(
      'button',
      { class: 'ytp-button bili2ytb-toggle', title: 'B站弹幕', 'aria-label': 'B站弹幕' },
      h('span', {}, '弹'),
    );
    btn.style.cssText =
      'font:bold 16px/1 sans-serif;color:#fff;text-align:center;vertical-align:top;width:48px;opacity:.9;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    if (bar) bar.prepend(btn);
    else {
      btn.style.cssText +=
        'position:absolute;top:12px;right:12px;z-index:69;height:32px;background:rgba(0,0,0,.6);border:0;border-radius:6px;';
      this.player.appendChild(btn);
    }
    return btn;
  }

  toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.button.style.color = open ? '#fb7299' : '#fff';
  }

  destroy() {
    this.host.remove();
    this.button.remove();
  }

  setMsg(text: string, ok = false) {
    this.msg.textContent = text;
    this.msg.classList.toggle('ok', ok);
  }

  render(state: PanelState) {
    this.state = state;
    this.enabledBox.checked = state.enabled;
    this.list.replaceChildren(
      ...(state.sources.length
        ? state.sources.map((s) => this.renderSource(s, state.status.get(s.id)))
        : [h('div', { class: 'meta' }, '还没有绑定 B 站视频。粘贴链接后点"添加"。')]),
    );
    if (this.search) this.renderResults();
    this.foot.textContent = state.totalCount
      ? `共 ${state.totalCount} 条，显示 ${state.shownCount} 条（过滤/合并后）`
      : '';
  }

  private async runSearch(keyword: string, page: number) {
    this.setMsg(`搜索"${keyword}"…`, true);
    try {
      const result = await this.actions.search(keyword, page);
      this.search = { keyword, result };
      this.setMsg(result.hits.length ? '' : '没有找到相关视频', true);
      this.renderResults();
    } catch (e) {
      this.setMsg((e as Error).message);
    }
  }

  private renderResults() {
    const s = this.search;
    this.results.hidden = !s || !s.result.hits.length;
    if (!s || !s.result.hits.length) return this.results.replaceChildren();
    const { keyword, result } = s;
    const bound = new Set(this.state?.sources.map((x) => x.bvid));
    const pager = h(
      'div',
      { class: 'row between pager' },
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          { class: 'small', disabled: result.page <= 1, onclick: () => this.runSearch(keyword, result.page - 1) },
          '上一页',
        ),
        `${result.page} / ${result.numPages}`,
        h(
          'button',
          {
            class: 'small',
            disabled: result.page >= result.numPages,
            onclick: () => this.runSearch(keyword, result.page + 1),
          },
          '下一页',
        ),
      ),
      h(
        'button',
        { class: 'link', onclick: () => ((this.search = null), this.renderResults()) },
        '收起',
      ),
    );
    this.results.replaceChildren(...result.hits.map((hit) => this.renderHit(hit, bound.has(hit.bvid))), pager);
  }

  private renderHit(hit: SearchHit, added: boolean): HTMLElement {
    const img = h('img', { src: `${hit.pic}@192w_108h_1c.webp`, referrerpolicy: 'no-referrer', alt: '', loading: 'lazy' });
    img.addEventListener('error', () => (img.style.visibility = 'hidden'), { once: true });
    const btn = h('button', { class: 'small primary', disabled: added }, added ? '已添加' : '添加');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      this.setMsg('解析中…', true);
      try {
        this.setMsg((await this.actions.add(hit.bvid, this.concat.checked)) ?? '已添加', true);
        btn.textContent = '已添加';
      } catch (e) {
        btn.disabled = false;
        this.setMsg((e as Error).message);
      }
    });
    const date = new Date(hit.pubdate * 1000).toLocaleDateString('zh-CN');
    return h(
      'div',
      { class: 'hit' },
      img,
      h(
        'div',
        { class: 'body' },
        h(
          'a',
          { class: 't', href: `https://www.bilibili.com/video/${hit.bvid}`, target: '_blank', rel: 'noopener', title: hit.title },
          hit.title,
        ),
        h(
          'div',
          { class: 'meta' },
          `${hit.author} · ${formatTime(hit.duration, false)} · ${compact(hit.play)}播放 · ${compact(hit.danmaku)}弹幕 · ${date}`,
        ),
      ),
      btn,
    );
  }

  private renderSource(s: Source, st: SourceStatus | undefined): HTMLElement {
    const { actions } = this;
    const offInput = h('input', { type: 'text', class: 'off', value: s.offset.toFixed(1), title: '偏移（秒）' });
    const commitOffset = () => {
      const v = offInput.value.trim() === '' ? NaN : Number(offInput.value);
      if (Number.isFinite(v)) actions.update(s.id, { offset: Math.round(v * 10) / 10 });
      else offInput.value = s.offset.toFixed(1);
    };
    offInput.addEventListener('change', commitOffset);
    offInput.addEventListener('keydown', (e) => e.key === 'Enter' && commitOffset());
    const nudge = (d: number) =>
      h(
        'button',
        { class: 'small', onclick: () => actions.update(s.id, { offset: Math.round((s.offset + d) * 10) / 10 }) },
        d > 0 ? `+${d}` : String(d),
      );

    const status =
      st?.state === 'loading'
        ? h('span', { class: 'meta' }, '加载中…')
        : st?.state === 'error'
          ? h(
              'span',
              { class: 'err' },
              st.error ?? '加载失败',
              ' ',
              h('button', { class: 'link', onclick: () => actions.retry(s.id) }, '重试'),
            )
          : h('span', { class: 'meta' }, `${st?.count ?? 0} 条`);

    const enabled = h('input', {
      type: 'checkbox',
      checked: s.enabled,
      onchange: () => actions.update(s.id, { enabled: enabled.checked }),
    });

    const syncOpen = this.syncFor?.id === s.id;
    let sync: HTMLElement | null = null;
    if (syncOpen && this.syncFor) {
      const ytTime = this.syncFor.ytTime;
      const biliInput = h('input', { type: 'text', class: 'off', placeholder: 'mm:ss', style: 'width:80px' });
      const apply = () => {
        const t = parseTime(biliInput.value);
        if (t === null) return this.setMsg('时间格式应为 秒、mm:ss 或 h:mm:ss');
        this.syncFor = null;
        actions.update(s.id, { offset: Math.round((ytTime - t) * 10) / 10 });
      };
      biliInput.addEventListener('keydown', (e) => e.key === 'Enter' && apply());
      sync = h(
        'div',
        { class: 'sync' },
        h('div', { class: 'meta' }, `YouTube 当前时间 ${formatTime(ytTime)} 对应 B 站视频的时间：`),
        h(
          'div',
          { class: 'row', style: 'margin-top:4px' },
          biliInput,
          h('button', { class: 'small primary', onclick: apply }, '应用'),
          h('button', { class: 'small', onclick: () => ((this.syncFor = null), this.rerender()) }, '取消'),
        ),
      );
      queueMicrotask(() => biliInput.focus());
    }

    return h(
      'div',
      { class: 'src' },
      h(
        'div',
        { class: 'row' },
        enabled,
        h('span', { class: 'title', title: s.title }, s.title),
        status,
      ),
      h(
        'div',
        { class: 'meta', style: 'margin:2px 0 4px 22px' },
        s.kind === 'file'
          ? `本地文件 · ${formatTime(s.duration, false)}`
          : `${s.bvid} · P${s.page} · ${formatTime(s.duration, false)}`,
        s.list ? h('span', { class: 'badge' }, ` · 订阅「${s.list.name}」`) : null,
        s.list?.overridden
          ? s.enabled
            ? ` · 已改，订阅偏移 ${s.list.offset.toFixed(1)}`
            : ' · 已停用'
          : null,
        s.list?.others.length
          ? h('div', {}, `其他订阅：${s.list.others.map((o) => `「${o.name}」${o.offset.toFixed(1)}`).join('，')}`)
          : null,
      ),
      h(
        'div',
        { class: 'row', style: 'margin-left:22px;flex-wrap:wrap' },
        nudge(-10),
        nudge(-1),
        nudge(-0.1),
        offInput,
        nudge(0.1),
        nudge(1),
        nudge(10),
        h(
          'button',
          {
            class: 'small',
            title: '把 YouTube 当前画面与 B 站视频中的某个时间对齐',
            onclick: () => {
              this.syncFor = { id: s.id, ytTime: actions.currentTime() };
              this.rerender();
            },
          },
          '对齐',
        ),
        s.list?.overridden
          ? h(
              'button',
              { class: 'small', title: '撤销自己的修改，重新使用订阅的偏移', onclick: () => actions.restore(s.id) },
              '恢复订阅',
            )
          : s.list
            ? null // subscribed entries can be disabled with the checkbox, not deleted
            : h('button', { class: 'small', onclick: () => actions.remove(s.id) }, '删除'),
      ),
      sync,
    );
  }

  private rerender() {
    if (this.state) this.render(this.state);
  }
}

function compact(n: number): string {
  return n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : String(n);
}
