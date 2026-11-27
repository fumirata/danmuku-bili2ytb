import { browser } from 'wxt/browser';
import { buildList } from '../../src/core/list';
import type { DmMode, Settings, Source } from '../../src/core/types';
import type { ListStatus } from '../../src/lists';
import { send } from '../../src/messaging';
import {
  exportBindings,
  importBindings,
  loadSettings,
  loadSubscriptions,
  saveSettings,
  saveSubscriptions,
} from '../../src/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const msg = (t: string) => ($('msg').textContent = t);

type RangeKey = 'opacity' | 'fontScale' | 'speed' | 'area' | 'maxPerSecond';
const fmt: Record<RangeKey, (v: number) => string> = {
  opacity: (v) => `${Math.round(v * 100)}%`,
  fontScale: (v) => `${v.toFixed(2)}×`,
  speed: (v) => String(v),
  area: (v) => `${Math.round(v * 100)}%`,
  maxPerSecond: (v) => (v ? String(v) : '不限'),
};

async function init() {
  const s = await loadSettings();

  const enabled = $<HTMLInputElement>('enabled');
  enabled.checked = s.enabled;
  enabled.onchange = () => saveSettings({ enabled: enabled.checked });

  const dedupe = $<HTMLInputElement>('dedupe');
  dedupe.checked = s.dedupe;
  dedupe.onchange = () => saveSettings({ dedupe: dedupe.checked });

  for (const key of Object.keys(fmt) as RangeKey[]) {
    const input = $<HTMLInputElement>(key);
    const label = $(`${key}-v`);
    input.value = String(s[key]);
    label.textContent = fmt[key](s[key]);
    input.oninput = () => (label.textContent = fmt[key](Number(input.value)));
    input.onchange = () => saveSettings({ [key]: Number(input.value) } as Partial<Settings>);
  }

  const modeBoxes = [...document.querySelectorAll<HTMLInputElement>('[data-mode]')];
  for (const box of modeBoxes) {
    box.checked = s.blockModes.includes(box.dataset.mode as DmMode);
    box.onchange = () =>
      saveSettings({ blockModes: modeBoxes.filter((b) => b.checked).map((b) => b.dataset.mode as DmMode) });
  }

  const kw = $<HTMLTextAreaElement>('blockKeywords');
  kw.value = s.blockKeywords.join('\n');
  kw.onchange = () => saveSettings({ blockKeywords: kw.value.split('\n').map((x) => x.trim()).filter(Boolean) });

  $('export').onclick = async () => {
    const data = await exportBindings();
    download(data, 'bili2ytb-bindings.json');
    msg(`已导出 ${Object.keys(data).length} 个视频的绑定`);
  };

  const listName = $<HTMLInputElement>('listName');
  listName.value = s.listName;
  listName.onchange = () => saveSettings({ listName: listName.value.trim() });
  $('exportList').onclick = async () => {
    const list = buildList(await exportBindings(), { name: listName.value });
    download(list, 'bili2ytb-list.json');
    msg(`已导出订阅文件，含 ${Object.keys(list.entries).length} 个视频`);
  };

  const subUrl = $<HTMLInputElement>('subUrl');
  const subscribe = async () => {
    const url = subUrl.value.trim();
    if (!url) return;
    msg('下载中…');
    try {
      const st = await send({ type: 'subscribe', url });
      subUrl.value = '';
      msg(`已订阅「${st.name}」，含 ${st.count} 个视频`);
    } catch (e) {
      msg((e as Error).message);
      if (/授权/.test((e as Error).message)) showGrant(url, subscribe);
    }
    await renderSubs();
  };
  $('subscribe').onclick = subscribe;
  subUrl.onkeydown = (e) => e.key === 'Enter' && void subscribe();
  $('refreshAll').onclick = async () => {
    msg('刷新中…');
    const r = await send({ type: 'refreshLists' });
    msg(`已刷新 ${r.length} 个订阅${r.some((x) => x.error) ? '，部分失败' : ''}`);
    await renderSubs();
  };
  await renderSubs();
  const file = $<HTMLInputElement>('file');
  $('import').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const n = await importBindings(JSON.parse(await f.text()) as Record<string, Source[]>);
      msg(`已导入 ${n} 个视频的绑定，刷新 YouTube 页面后生效`);
    } catch (e) {
      msg(`导入失败：${(e as Error).message}`);
    }
  };
}

function download(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

/** Shows a one-off button that requests access to the list's origin. Must run inside the click handler. */
function showGrant(url: string, retry: () => void) {
  if (new URL(url).protocol !== 'https:') return; // optional_host_permissions only covers https
  const origin = `${new URL(url).origin}/*`;
  const btn = el('button', { textContent: `授权读取 ${new URL(url).host}` });
  btn.onclick = async () => {
    const ok = await browser.permissions.request({ origins: [origin] }).catch(() => false);
    btn.remove();
    if (ok) retry();
    else msg('未授权');
  };
  $('msg').append(' ', btn);
}

async function renderSubs() {
  const subs = await loadSubscriptions();
  const status = new Map((await send({ type: 'listStatus' }).catch(() => [] as ListStatus[])).map((x) => [x.url, x]));
  const box = $('subs');
  if (!subs.length) {
    box.replaceChildren(el('div', { className: 'hint', textContent: '还没有订阅。' }));
    return;
  }
  const save = async (next: typeof subs) => {
    await saveSubscriptions(next);
    await renderSubs();
  };
  box.replaceChildren(
    ...subs.map((sub, i) => {
      const st = status.get(sub.url);
      const enabled = el('input', { type: 'checkbox', checked: sub.enabled, title: '启用' });
      enabled.onchange = () => save(subs.map((x, j) => (j === i ? { ...x, enabled: enabled.checked } : x)));
      const btn = (text: string, title: string, fn: () => void, disabled = false) => {
        const b = el('button', { textContent: text, title, disabled });
        b.onclick = fn;
        return b;
      };
      const move = (d: number) => {
        const next = [...subs];
        [next[i], next[i + d]] = [next[i + d]!, next[i]!];
        void save(next);
      };
      const refresh = async () => {
        msg('刷新中…');
        const [r] = await send({ type: 'refreshLists', url: sub.url });
        msg(r?.error ? `刷新失败：${r.error}` : `已刷新「${r?.name}」`);
        if (r?.needsPermission) showGrant(sub.url, refresh);
        await renderSubs();
      };
      const when = st?.fetchedAt ? new Date(st.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '未下载';
      return el(
        'div',
        { className: 'sub' },
        el(
          'div',
          { className: 'row' },
          enabled,
          el('span', { className: 'name', title: st?.name ?? sub.url, textContent: st?.name ?? '（未下载）' }),
          el(
            'span',
            { className: 'tools' },
            btn('↑', '提高优先级', () => move(-1), i === 0),
            btn('↓', '降低优先级', () => move(1), i === subs.length - 1),
            btn('刷新', '重新下载', () => void refresh()),
            btn('删除', '取消订阅', () => void save(subs.filter((_, j) => j !== i))),
          ),
        ),
        el('div', { className: 'url', textContent: sub.url }),
        el('div', { className: 'hint', textContent: `${st?.count ?? 0} 个视频 · 下载于 ${when}` }),
        ...(st?.error ? [el('div', { className: 'err', textContent: st.error })] : []),
      );
    }),
  );
}

void init();
