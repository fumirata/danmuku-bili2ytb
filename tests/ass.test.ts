import { describe, expect, it } from 'vitest';
import { parseAss, parseDanmakuFile } from '../src/bili/parse';

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold
Style: Danmaku, Microsoft YaHei, 50, &H00FFFFFF, &H00FFFFFF, &H00000000, &H00000000, 0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 2,0:00:01.50,0:00:09.50,Danmaku,,0000,0000,0000,,{\\move(1920, 50, -200, 50)}hello, world
Dialogue: 2,0:01:02.00,0:01:06.00,Danmaku,,0000,0000,0000,,{\\an8\\pos(960, 50)\\c&H0000FF&}顶部红色
Dialogue: 2,1:00:00.00,1:00:04.00,Danmaku,,0000,0000,0000,,{\\an2\\pos(960,1030)\\fs80}底部
Dialogue: 2,0:00:03.00,0:00:11.00,Danmaku,,0000,0000,0000,,{\\move(-100, 50, 2000, 50)}逆向
Dialogue: 2,0:00:04.00,0:00:11.00,Danmaku,,0000,0000,0000,,{\\pos(10,10)}
Comment: 0,0:00:05.00,0:00:06.00,Danmaku,,0,0,0,,ignored
`;

describe('parseAss', () => {
  it('infers mode, time, color and size', () => {
    expect(parseAss(ASS)).toEqual([
      { time: 1.5, mode: 'rtl', size: 25, color: 0xffffff, text: 'hello, world', weight: 0 },
      { time: 62, mode: 'top', size: 25, color: 0xff0000, text: '顶部红色', weight: 0 },
      { time: 3600, mode: 'bottom', size: 40, color: 0xffffff, text: '底部', weight: 0 },
      { time: 3, mode: 'ltr', size: 25, color: 0xffffff, text: '逆向', weight: 0 },
    ]);
  });

  it('works without a Format line or styles', () => {
    const list = parseAss('[Events]\nDialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,plain');
    expect(list).toEqual([{ time: 10, mode: 'rtl', size: 25, color: 0xffffff, text: 'plain', weight: 0 }]);
  });
});

describe('parseDanmakuFile', () => {
  it('dispatches by name and content', () => {
    expect(parseDanmakuFile('a.ass', ASS)).toHaveLength(4);
    expect(parseDanmakuFile('a.txt', '<i><d p="1,1,25,0,0,0,a,1,0">x</d></i>')).toHaveLength(1);
    expect(() => parseDanmakuFile('a.txt', 'nope')).toThrow();
  });
});
