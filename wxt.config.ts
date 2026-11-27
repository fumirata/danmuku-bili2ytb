import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  manifest: {
    name: 'Bili 弹幕 for YouTube',
    description: '在 YouTube 上显示一个或多个哔哩哔哩视频的弹幕',
    permissions: ['storage'],
    host_permissions: ['*://*.youtube.com/*', '*://*.bilibili.com/*'],
  },
});
