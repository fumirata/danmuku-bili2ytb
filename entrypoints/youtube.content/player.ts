/** All YouTube DOM knowledge lives here so a redesign only touches this file. */

export interface PlayerEls {
  player: HTMLElement;
  video: HTMLVideoElement;
}

export function getVideoId(url = location.href): string | null {
  const u = new URL(url);
  if (u.pathname !== '/watch') return null;
  return u.searchParams.get('v');
}

export function findPlayer(): PlayerEls | null {
  const player = document.querySelector<HTMLElement>('#movie_player');
  const video =
    player?.querySelector<HTMLVideoElement>('video.html5-main-video') ?? player?.querySelector('video');
  if (player && video) return { player, video };
  // Fallback for layout changes: any video inside a player-ish parent.
  const v = document.querySelector<HTMLVideoElement>('video');
  const parent = v?.closest<HTMLElement>('.html5-video-player') ?? v?.parentElement;
  return v && parent ? { player: parent, video: v } : null;
}

export function waitForPlayer(signal: AbortSignal, timeout = 15000): Promise<PlayerEls | null> {
  return new Promise((resolve) => {
    const found = findPlayer();
    if (found) return resolve(found);
    const done = (v: PlayerEls | null) => {
      obs.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    const obs = new MutationObserver(() => {
      const p = findPlayer();
      if (p) done(p);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => done(null), timeout);
    signal.addEventListener('abort', () => done(null));
  });
}

export function isAdShowing(player: HTMLElement): boolean {
  return player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
}

/** Calls `cb(adShowing)` whenever the player's ad state flips. */
export function watchAds(player: HTMLElement, cb: (ad: boolean) => void): () => void {
  let last = isAdShowing(player);
  const obs = new MutationObserver(() => {
    const now = isAdShowing(player);
    if (now !== last) cb((last = now));
  });
  obs.observe(player, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}

/** Where to put our toolbar button, if YouTube's control bar is present. */
export function findControlsBar(player: HTMLElement): HTMLElement | null {
  // 2025+ layout splits the right controls into -left / -right flex groups.
  return (
    player.querySelector<HTMLElement>('.ytp-right-controls-left') ??
    player.querySelector<HTMLElement>('.ytp-right-controls')
  );
}

export function formatTime(sec: number, tenths = true): string {
  const s = Math.max(0, tenths ? sec : Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = tenths ? (s % 60).toFixed(1).padStart(4, '0') : String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Parses "75", "1:15", "1:15.5", "1:02:03" into seconds. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}
