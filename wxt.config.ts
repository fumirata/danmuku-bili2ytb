import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  manifest: {
    name: 'Bili 弹幕 for YouTube',
    description: '在 YouTube 上显示一个或多个哔哩哔哩视频的弹幕',
    permissions: ['storage', 'alarms'],
    host_permissions: ['*://*.youtube.com/*', '*://*.bilibili.com/*'],
    // subscribed mapping lists on hosts that don't send CORS headers; requested per origin from the popup
    optional_host_permissions: ['https://*/*'],
  },
});
