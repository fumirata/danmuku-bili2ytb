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

function scaleFor(height: number): number {
  return Math.min(2.5, Math.max(0.6, (height || REFERENCE_HEIGHT) / REFERENCE_HEIGHT));
}

/**
 * Canvas layer on top of the YouTube video that renders comments in sync with it.
 *
 * Comments are rendered once at the size they would have in a full-screen player (`built`), on a
 * stage that is CSS-scaled down to the current player. Resizing the player (entering or leaving
 * full screen, theater mode) only changes that scale, so comments on screen keep moving instead of
 * being cleared by a rebuild.
 */
export class Overlay {
  /** clips to the danmaku area */
  private root: HTMLDivElement;
  /** danmaku container, sized in "built" pixels and scaled to fit `root` */
  private stage: HTMLDivElement;
  private dm: Danmaku | null = null;
  private comments: PlacedComment[] = [];
  private ro: ResizeObserver;
  private unwatchAds: () => void;
  /** scale the comment fonts were rendered at */
  private built = 1;
  /** current CSS scale of the stage = player scale / built */
  private ratio = 1;
  private resizeFrame = 0;
  /** stage size the danmaku engine last measured */
  private size = '';

  constructor(
    private player: HTMLElement,
    private video: HTMLVideoElement,
    private settings: Settings,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'bili2ytb-overlay';
    this.root.style.cssText =
      'position:absolute;left:0;top:0;width:100%;pointer-events:none;overflow:hidden;z-index:35;';
    this.stage = document.createElement('div');
    this.stage.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;';
    this.root.appendChild(this.stage);
    player.appendChild(this.root);
    this.applyStyle();
    this.built = this.targetScale();
    this.layout();

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
      if (this.dm && prev.speed !== next.speed) this.dm.speed = next.speed / this.ratio;
      if (prev.area !== next.area) this.layout();
      this.applyVisibility();
    }
  }

  destroy() {
    cancelAnimationFrame(this.resizeFrame);
    this.ro.disconnect();
    this.unwatchAds();
    this.dm?.destroy();
    this.dm = null;
    this.root.remove();
  }

  /** Render scale: big enough for full screen, or for the player if it is larger still. */
  private targetScale(): number {
    return Math.max(scaleFor(screen.height), scaleFor(this.player.clientHeight));
  }

  /** Sizes and scales the stage to the current player; keeps the visible speed in screen pixels. */
  private layout() {
    this.ratio = scaleFor(this.player.clientHeight) / this.built;
    const w = Math.round(this.root.clientWidth / this.ratio);
    const h = Math.round(this.root.clientHeight / this.ratio);
    this.stage.style.width = `${w}px`;
    this.stage.style.height = `${h}px`;
    this.stage.style.transform = `scale(${this.ratio})`;
    const changed = this.size !== `${w}x${h}`;
    this.size = `${w}x${h}`;
    if (!this.dm) return;
    this.dm.speed = this.settings.speed / this.ratio;
    if (changed) this.dm.resize();
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
    cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      // Only a player bigger than the render size (e.g. moved to a larger monitor) needs new canvases;
      // anything smaller is just scaled down.
      if (this.targetScale() > this.built * 1.05) {
        this.built = this.targetScale();
        this.rebuild();
      } else this.layout();
    });
  }

  private toDm(c: PlacedComment): DmComment {
    const px = Math.round(c.size * this.built * this.settings.fontScale);
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
    this.layout();
    this.dm = new Danmaku({
      container: this.stage,
      media: this.video,
      comments: this.comments.map((c) => this.toDm(c)),
      engine: 'canvas',
      speed: this.settings.speed / this.ratio,
    });
    this.applyVisibility();
  }
}
