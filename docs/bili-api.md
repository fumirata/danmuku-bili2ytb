# B 站接口实测记录（M0）

实测日期：2026-11-27，未登录，无 Cookie，普通浏览器 UA。样本视频 `BV1GJ411x7h7`（cid 137649199，213 秒）。

| 接口 | 结果 | 备注 |
|---|---|---|
| `GET api.bilibili.com/x/web-interface/view?bvid=` | 200，`code:0` | `data.pages[]` 含 `cid / page / part / duration` |
| `GET api.bilibili.com/x/player/pagelist?bvid=` | 200，`code:0` | 与 view 中 pages 相同，未使用 |
| `GET api.bilibili.com/x/v1/dm/list.so?oid={cid}` | 200，`Content-Encoding: deflate`，XML | 返回 1200 条（`maxlimit` 字段为 1000，仅供参考）；浏览器 fetch 自动解压 |
| `GET api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid={cid}&segment_index=1` | 200，protobuf，163 KB | **无需登录、无需 WBI 签名**；每段 6 分钟 |

## 结论
- 主路径：`seg.so` 分段（数据更全），段数 `ceil(duration / 360)`；任一失败则回退 `list.so`。
- 暂不实现 WBI。若将来 seg.so 要求签名（返回 `-352` / `-403` 或 HTTP 412），在 `src/bili/client.ts` 中补充。
- HTTP 412 / `code:-412` = 风控，提示用户在浏览器中登录 B 站后重试。

## XML `<d p="...">` 字段
`time(秒),mode,fontsize,color(十进制),ctime,pool,midHash,id,weight`

## Protobuf `DmSegMobileReply`
- `1: repeated DanmakuElem elems`
- `DanmakuElem`: `1 id(int64) 2 progress(int32, 毫秒) 3 mode 4 fontsize 5 color(uint32) 6 midHash(string) 7 content(string) 8 ctime(int64) 9 weight 10 action 11 pool 12 idStr ...`

## mode 映射
`1/2/3 → 滚动(rtl)`，`4 → 底部`，`5 → 顶部`，`6 → 逆向(ltr)`，`7/8/9`（高级/代码/BAS）忽略。
