import { defineContentScript } from 'wxt/utils/define-content-script';
import { loadSettings, onSettingsChanged } from '../../src/storage';
import { getVideoId, waitForPlayer } from './player';
import { Session } from './session';

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    let settings = await loadSettings();
    let session: Session | null = null;
    let currentId: string | null = null;
    let abort: AbortController | null = null;

    const teardown = () => {
      abort?.abort();
      session?.destroy();
      session = null;
    };

    let pending = false;
    const check = async () => {
      const id = getVideoId();
      if (id === currentId && (!id || pending || session?.player.isConnected)) return;
      teardown();
      currentId = id;
      if (!id) return;
      const ac = (abort = new AbortController());
      pending = true;
      try {
        const els = await waitForPlayer(ac.signal);
        if (!els || ac.signal.aborted || getVideoId() !== id) return;
        session = new Session(id, els, settings);
        void session.start();
      } finally {
        if (abort === ac) pending = false;
      }
    };

    // YouTube is an SPA: listen to its own navigation event, plus a cheap poll as a safety net.
    ctx.addEventListener(document, 'yt-navigate-finish' as keyof DocumentEventMap, () => void check());
    ctx.setInterval(() => void check(), 1500);
    const off = onSettingsChanged((s) => {
      settings = s;
      session?.applySettings(s);
    });
    ctx.onInvalidated(() => {
      off();
      teardown();
    });
    void check();
  },
});
