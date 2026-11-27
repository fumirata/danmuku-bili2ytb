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

## 发布

推送 `v` 开头的版本标签后，GitHub Actions（[.github/workflows/release.yml](.github/workflows/release.yml)）会做类型检查、测试和打包，并创建 Release，附上 `*-chrome.zip`。

```powershell
npm version 0.2.0          # 改 package.json 的版本号，并创建提交和 v0.2.0 标签
git push --follow-tags     # 推送提交和标签，触发发布
```

- 标签必须和 `package.json` 的版本号一致，否则工作流会报错退出。
- 标签里带连字符（如 `v0.2.0-beta.1`）的会发布为预发布版本。
- 在 Actions 页面手动运行 Release 工作流时只做构建，zip 作为工作流产物上传，不创建 Release。

## 使用

1. 打开任意 YouTube 视频，点控制栏右侧的 **弹** 按钮。
2. 粘贴 B 站链接、BV 号或 av 号，点"添加"。链接带 `?p=N` 时只添加该P；勾选"全部分P按顺序拼接"时添加全部P，偏移自动累加。
3. 也可以输入关键词点"搜索"（输入框为空时搜索当前 YouTube 视频的标题），在结果里直接点"添加"。回车时，链接和 BV/av 号会直接添加，其他内容会去搜索。
4. 用 ±0.1 / ±1 / ±10 按钮或直接输入秒数来调整偏移；也可以在两边的同一画面点"对齐"，输入 B 站视频里对应的时间。
5. B 站接口不可用时，可以点"导入文件"，导入 B 站 XML 弹幕或 ASS 弹幕字幕（如 danmaku2ass / biliass 生成的）作为来源。导入的数据保存在扩展的 IndexedDB 中，删除来源时一起删除；导出绑定时不包含文件内容。
6. 弹幕在本地缓存 24 小时；来源加载失败时点"重试"会跳过缓存重新拉取。
7. 订阅别人的对照表：在弹出页"订阅对照表"里填订阅文件的 https 地址。订阅里有的视频会直接显示对应弹幕，来源旁标着"订阅「列表名」"，订阅更新后自动跟着变（每 12 小时检查一次）。在面板里改偏移或取消勾选会生成你自己的修改，只影响你，点"恢复订阅"撤销。同一分P以你自己的为准，几个订阅都有时以排在前面的为准。
8. 分享自己的绑定：在弹出页"分享我的绑定"里填一个名称，点"导出订阅文件"（包括自己添加的和改过偏移的订阅来源，不包括原样使用的订阅来源），把 `bili2ytb-list.json` 上传到 GitHub Gist 等处，把 raw 链接发给别人。格式见 [docs/list-format.md](docs/list-format.md)。
9. 扩展图标弹出页：设置不透明度、字号、速度、显示区域、每秒上限、屏蔽等级、去重、屏蔽类型和屏蔽词，以及导入/导出绑定。

## 结构

| 路径 | 作用 |
|---|---|
| `src/bili/` | B 站接口（`client.ts`，含搜索与 WBI 签名 `wbi.ts`）、XML 与 protobuf 解析（`parse.ts`）、链接解析（`input.ts`） |
| `src/core/` | 类型、合并（偏移 → 过滤 → 去重 → 密度控制）、屏蔽规则 |
| `src/storage.ts` | 设置与订阅列表（sync）、每个 YouTube 视频的绑定（local） |
| `src/lists.ts`、`src/core/list.ts` | 订阅文件的下载、缓存、查询，以及格式校验与导出 |
| `entrypoints/background.ts` | 跨域请求 B 站；IndexedDB 缓存（`src/idb.ts`）与本地文件存储 |
| `entrypoints/youtube.content/` | 单页导航、播放器适配、Canvas 弹幕层、控制面板 |
| `entrypoints/popup/` | 全局设置 |
| `docs/bili-api.md` | 接口实测记录 |
