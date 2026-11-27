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
  /** saved: this own source overrides (offset / enabled) the entry of the subscribed list at this URL */
  from?: string;
  /** runtime only, never saved: the subscribed list that provides this page */
  list?: SourceList;
}

export interface SourceList {
  url: string;
  name: string;
  /** offset given by the list */
  offset: number;
  /** lower-priority lists that also provide this page */
  others: { name: string; offset: number }[];
  /** an own source replaces the list's entry */
  overridden: boolean;
}

export interface Settings {
  enabled: boolean;
  /** 0.1 – 1 */
  opacity: number;
  /** font size multiplier */
  fontScale: number;
  /** true: fonts grow and shrink with the player; false: same screen size in every player size */
  scaleWithPlayer: boolean;
  /** pixels per second for scrolling comments */
  speed: number;
  /** fraction of the player height comments may use */
  area: number;
  /** 0 = unlimited */
  maxPerSecond: number;
  /** 0 – 10, hides comments whose Bilibili weight is below this; 0 = off */
  weightLevel: number;
  dedupe: boolean;
  /** seconds */
  dedupeWindow: number;
  blockModes: DmMode[];
  /** plain substrings, or /regex/flags */
  blockKeywords: string[];
  /** name written into exported list files */
  listName: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  opacity: 0.85,
  fontScale: 1,
  scaleWithPlayer: false,
  speed: 144,
  area: 0.75,
  maxPerSecond: 0,
  weightLevel: 0,
  dedupe: true,
  dedupeWindow: 3,
  blockModes: [],
  blockKeywords: [],
  listName: '',
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
