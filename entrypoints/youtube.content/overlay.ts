import Danmaku from 'danmaku';
import type { PlacedComment, Settings } from '../../src/core/types';
import { isAdShowing, watchAds } from './player';

const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
/** Player height at which Bilibili's 25px font renders at 25px (tuned on a real ~900px player). */
const REFERENCE_HEIGHT = 1080;

type DmComment = NonNullable<ConstructorParameters<typeof Danmaku>[0]['comments']>[number];

function hex(color: number): string {
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
}

/** Canvas layer on top of the YouTube video that renders comments in sync with it. */
export class Overlay {
  private root: HTMLDivElement;
  private dm: Danmaku | null = null;
  private comments: PlacedComment[] = [];
  private ro: ResizeObserver;
  private unwatchAds: () => void;
  private scale = 1;
  private resizeTimer = 0;

  constructor(
    private player: HTMLElement,
    private video: HTMLVideoElement,
    private settings: Settings,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'bili2ytb-overlay';
    this.root.style.cssText =
      'position:absolute;left:0;top:0;width:100%;pointer-events:none;overflow:hidden;z-index:35;';
    player.appendChild(this.root);
    this.applyStyle();
    this.scale = this.computeScale();

    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(player);
    this.unwatchAds = watchAds(player, () => this.applyVisibility());
  }

  setComments(list: PlacedComment[]) {
    this.comments = list;
    this.rebuild();
  }

  setSettings(next: Settings) {
    const prev = this.settings;
    this.settings = next;
    this.applyStyle();
    if (prev.fontScale !== next.fontScale || prev.enabled !== next.enabled) this.rebuild();
    else {
      if (this.dm && prev.speed !== next.speed) this.dm.speed = next.speed;
      if (prev.area !== next.area) this.dm?.resize();
      this.applyVisibility();
    }
  }

  destroy() {
    clearTimeout(this.resizeTimer);
    this.ro.disconnect();
    this.unwatchAds();
    this.dm?.destroy();
    this.dm = null;
    this.root.remove();
  }

  private computeScale(): number {
    const h = this.player.clientHeight || REFERENCE_HEIGHT;
    return Math.min(2.5, Math.max(0.6, h / REFERENCE_HEIGHT));
  }

  private applyStyle() {
    this.root.style.height = `${Math.round(this.settings.area * 100)}%`;
    this.root.style.opacity = String(this.settings.opacity);
  }

  private applyVisibility() {
    if (!this.dm) return;
    if (this.settings.enabled && !isAdShowing(this.player)) this.dm.show();
    else this.dm.hide();
  }

  private onResize() {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      const s = this.computeScale();
      // Font sizes are baked into each comment's canvas, so a big size change needs a rebuild.
      if (Math.abs(s - this.scale) / this.scale > 0.1) {
        this.scale = s;
        this.rebuild();
      } else this.dm?.resize();
    }, 150);
  }

  private toDm(c: PlacedComment): DmComment {
    const px = Math.round(c.size * this.scale * this.settings.fontScale);
    const dark = (c.color & 0xffffff) < 0x303030;
    return {
      text: c.count > 1 ? `${c.text} ×${c.count}` : c.text,
      mode: c.mode,
      time: c.time,
      style: {
        font: `bold ${px}px/1.25 ${FONT}`,
        fillStyle: hex(c.color),
        strokeStyle: dark ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.75)',
        lineWidth: Math.max(1.5, px / 14),
        lineJoin: 'round',
      } as unknown as CanvasRenderingContext2D,
    };
  }

  private rebuild() {
    this.dm?.destroy();
    this.dm = null;
    if (!this.settings.enabled || this.comments.length === 0) return;
    this.dm = new Danmaku({
      container: this.root,
      media: this.video,
      comments: this.comments.map((c) => this.toDm(c)),
      engine: 'canvas',
      speed: this.settings.speed,
    });
    this.applyVisibility();
  }
}
