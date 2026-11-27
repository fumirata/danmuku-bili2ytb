import type { DmMode, Settings, Source } from '../../src/core/types';
import { exportBindings, importBindings, loadSettings, saveSettings } from '../../src/storage';

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
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'bili2ytb-bindings.json' });
    a.click();
    URL.revokeObjectURL(url);
    msg(`已导出 ${Object.keys(data).length} 个视频的绑定`);
  };
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

void init();
