# Bili 弹幕 for YouTube

在 YouTube 播放器上叠加显示一个或多个哔哩哔哩视频的弹幕。每个来源可以单独设置时间偏移，多P视频可以按顺序拼接。

## 开发

```powershell
pnpm install
pnpm dev        # 启动带热重载的 Chrome
pnpm test       # 单元测试（解析器 / 合并 / 过滤）
pnpm compile    # 类型检查
pnpm build      # 产出 .output/chrome-mv3
```

手动加载：打开 `chrome://extensions`，开启"开发者模式"，点"加载已解压的扩展程序"，选择 `.output/chrome-mv3`。

## 使用

1. 打开任意 YouTube 视频，点控制栏右侧的 **弹** 按钮。
2. 粘贴 B 站链接、BV 号或 av 号，点"添加"。链接带 `?p=N` 时只添加该P；勾选"全部分P按顺序拼接"时添加全部P，偏移自动累加。
3. 用 ±0.1 / ±1 / ±10 按钮或直接输入秒数来调整偏移；也可以在两边的同一画面点"对齐"，输入 B 站视频里对应的时间。
4. B 站接口不可用时，可以点"导入文件"，导入 B 站 XML 弹幕或 ASS 弹幕字幕（如 danmaku2ass / biliass 生成的）作为来源。导入的数据保存在扩展的 IndexedDB 中，删除来源时一起删除；导出绑定时不包含文件内容。
5. 弹幕在本地缓存 24 小时；来源加载失败时点"重试"会跳过缓存重新拉取。
6. 扩展图标弹出页：设置不透明度、字号、速度、显示区域、每秒上限、去重、屏蔽类型和屏蔽词，以及导入/导出绑定。

## 结构

| 路径 | 作用 |
|---|---|
| `src/bili/` | B 站接口（`client.ts`）、XML 与 protobuf 解析（`parse.ts`）、链接解析（`input.ts`） |
| `src/core/` | 类型、合并（偏移 → 过滤 → 去重 → 密度控制）、屏蔽规则 |
| `src/storage.ts` | 设置（sync）与每个 YouTube 视频的绑定（local） |
| `entrypoints/background.ts` | 跨域请求 B 站；IndexedDB 缓存（`src/idb.ts`）与本地文件存储 |
| `entrypoints/youtube.content/` | 单页导航、播放器适配、Canvas 弹幕层、控制面板 |
| `entrypoints/popup/` | 全局设置 |
| `docs/bili-api.md` | 接口实测记录 |
