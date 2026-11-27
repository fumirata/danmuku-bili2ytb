# 订阅文件格式 `bili2ytb-list/1`

订阅文件是一个 UTF-8 JSON 文件，记录"YouTube 视频 → B 站视频分P + 偏移"的对照。任何能通过 https 读取的地址都可以发布，例如 GitHub Gist 的 raw 链接、GitHub 仓库里的文件（`raw.githubusercontent.com`）、GitHub Pages。

```json
{
  "format": "bili2ytb-list/1",
  "name": "某某的搬运对照表",
  "homepage": "https://github.com/someone/lists",
  "updated": "2026-11-27T12:00:00.000Z",
  "entries": {
    "ujkD4SxPKOI": [
      { "bvid": "BV1AXpc6KEMc", "page": 1, "offset": -2.3 }
    ]
  }
}
```

| 字段 | 说明 |
|---|---|
| `format` | 固定为 `bili2ytb-list/1` |
| `name` | 列表名称，最多 100 字 |
| `homepage` | 可选，http(s) 链接 |
| `updated` | 可选，ISO 时间 |
| `entries` | 键为 11 位 YouTube 视频 ID，值为来源数组 |
| `bvid` | B 站 BV 号 |
| `page` | 分P，从 1 开始，默认 1 |
| `offset` | 偏移秒数（B 站时间 + 偏移 = YouTube 时间），保留一位小数，默认 0 |

规则：

- 文件最大 5 MB；每个视频最多取前 10 条，重复的 `bvid + page` 只保留第一条。
- 格式不对的条目会被忽略，不影响其他条目。
- 标题、时长、cid 不写进文件，由扩展向 B 站查询。弹幕本身也不在文件里。
- 扩展每 12 小时检查一次更新（支持 ETag）。
- 自己的绑定总是优先；多个订阅之间按弹出页里的顺序排优先级。
- 订阅地址需要允许跨域读取（Gist、`raw.githubusercontent.com`、GitHub Pages 都允许）。其他网站可以在弹出页点"授权"单独允许。
