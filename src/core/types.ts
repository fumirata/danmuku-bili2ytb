export type DmMode = 'rtl' | 'ltr' | 'top' | 'bottom';

/** A single parsed comment, time relative to its own Bilibili video. */
export interface RawComment {
  /** seconds */
  time: number;
  mode: DmMode;
  /** Bilibili font size, 25 is normal */
  size: number;
  /** 0xRRGGBB */
  color: number;
  text: string;
  weight: number;
}

/** A comment placed on the YouTube timeline, ready for rendering. */
export interface PlacedComment extends RawComment {
  sourceId: string;
  /** merged duplicates count (>= 1) */
  count: number;
}

/** One Bilibili page (or an imported local danmaku file) bound to a YouTube video. */
export interface Source {
  id: string;
  /** undefined = Bilibili page; 'file' = imported XML/ASS stored in the background's IndexedDB */
  kind?: 'file';
  bvid: string;
  cid: number;
  page: number;
  title: string;
  /** seconds */
  duration: number;
  /** seconds added to every comment time of this source */
  offset: number;
  enabled: boolean;
}

export interface Settings {
  enabled: boolean;
  /** 0.1 – 1 */
  opacity: number;
  /** font size multiplier */
  fontScale: number;
  /** pixels per second for scrolling comments */
  speed: number;
  /** fraction of the player height comments may use */
  area: number;
  /** 0 = unlimited */
  maxPerSecond: number;
  dedupe: boolean;
  /** seconds */
  dedupeWindow: number;
  blockModes: DmMode[];
  /** plain substrings, or /regex/flags */
  blockKeywords: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  opacity: 0.85,
  fontScale: 1,
  speed: 144,
  area: 0.75,
  maxPerSecond: 0,
  dedupe: true,
  dedupeWindow: 3,
  blockModes: [],
  blockKeywords: [],
};

export function biliMode(mode: number): DmMode | null {
  switch (mode) {
    case 1:
    case 2:
    case 3:
      return 'rtl';
    case 4:
      return 'bottom';
    case 5:
      return 'top';
    case 6:
      return 'ltr';
    default:
      return null;
  }
}
