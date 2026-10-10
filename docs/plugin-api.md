# 插件 API 参考

本文件列出 **Beat Data Generator** 当前暴露给插件的全部接口。类型定义以
[`plugins/plugin-api.d.ts`](../plugins/plugin-api.d.ts) 为准，在 `renderer.js` 顶部加
`/// <reference path="plugin-api.d.ts" />` 即可获得编辑器提示。

> 约定：本系统**不提供“替换核心 UI”的能力**。插件扩展界面只有浮窗面板与时间轴叠加层。
> 另外，注册面板（`registerPanel`）会自动在「插件」菜单生成一个带开合状态的菜单项，
> 因此**不要再用 `registerAction` 重复开关同一个面板——菜单入口只保留一个**。

- 插件结构、扫描目录、`manifest.json`、市场与发布流程见 [`plugin-system.md`](./plugin-system.md)。
- 示例：`plugins/example-basic`（基础贡献）；音频裁剪插件
  （[bdg_plugin_audiotrim](https://github.com/beat-data-generator/bdg_plugin_audiotrim)）演示叠加层与音频 API。

---

## renderer.js 入口

```js
/// <reference path="plugin-api.d.ts" />
window.__bdgPluginRegister(function activate(api) {
  // 注册贡献……
  return function dispose() {
    // 可选：卸载清理（取消订阅等）
  };
});
```

`activate(api)` 同步执行；返回的函数可选，于插件禁用 / 重载时调用。

---

## 顶层

| 成员              | 说明                                     |
| ----------------- | ---------------------------------------- |
| `api.id`          | 插件 id（只读）                          |
| `api.version`     | 插件版本（只读）                         |
| `api.dir`         | 插件目录绝对路径（只读）                 |
| `api.log(...args)`| 输出到控制台（带 `[plugin:<id>]` 前缀）  |

---

## `api.project` — 读取与编辑工程

```ts
api.project.snapshot(): ProjectSnapshot
api.project.bpmAtBeat(beat: number): number      // 该拍的 BPM
api.project.bpmAtTime(ms: number): number        // 该时刻的 BPM
api.project.timeOfBeat(beat: number): number      // 拍号 → 时间(ms)
api.project.beatOfTime(ms: number): number        // 时间(ms) → 拍号(可为小数)
```

`ProjectSnapshot`：

```ts
{
  name: string;
  baseBpm: number;
  offsetMs: number;         // 拍 0 对应的时间
  audioName: string | null;
  audioMd5: string | null;
  bpmLocked: boolean;
  tracks: Array<{ id; name; color; locked; hidden; type }>; // hidden 轨道不下发
  markers: Array<{
    id; trackId; beat; timeMs;              // timeMs 已按当前 tempo map 换算
    parentId?: string;                       // 循环组子点指向主点
    loop?: { interval; count; exclude? } | null;
    attrs?: Record<string, unknown>;         // 类型化轨道的字段
  }>;
  bpmPoints: Array<{ id; beat; mode: "abs" | "mult"; value }>;
}
```

### 编辑（自动计入撤销栈）

多步编辑用 `edit.batch(fn)` 合并为**一次**撤销。

```ts
api.project.edit.addTrack(opts?: { name?: string }): string
api.project.edit.addTypedTrack(typeKey: string, name?: string): string | null
api.project.edit.removeTrack(trackId: string): void
api.project.edit.renameTrack(trackId: string, name: string): void
api.project.edit.setTrackLocked(trackId: string, v: boolean): void
api.project.edit.setTrackHidden(trackId: string, v: boolean): void

api.project.edit.addMarker(opts: { trackId: string; beat: number }): string | null
api.project.edit.moveMarker(id: string, beat: number): boolean
api.project.edit.removeMarker(id: string): void              // 主点会级联删除其循环子点
api.project.edit.setMarkerAttrs(id: string, attrs: Record<string, unknown>): void
api.project.edit.setMarkerLoop(id: string, cfg: { interval; count; exclude? } | null): void

api.project.edit.addBpmPoint(beat: number): string | null
api.project.edit.removeBpmPoint(id: string): void
api.project.edit.setBaseBpm(v: number): void
api.project.edit.setOffset(v: number): void

api.project.edit.batch(fn: () => void): void
api.project.edit.undo(): void
api.project.edit.redo(): void
```

> 循环组：子点位于 `主点拍位 + k × interval`，与同轨道已有踩点重合处不生成；`count` 上限
> **256**，`exclude` 按 **1 起**编号跳过指定子点。传 `null` 清除循环并删除子点。

---

## `api.selection` — 选区

```ts
api.selection.current(): { kind: "marker" | "bpm" | null; id: string | null; markerIds: string[] }
api.selection.selectMarker(id: string): void
api.selection.selectBpm(id: string): void
api.selection.clear(): void
```

---

## `api.player` — 播放控制

```ts
api.player.play(): void
api.player.pause(): void
api.player.togglePlay(): void
api.player.stop(): void
api.player.seekTo(ms: number): void
api.player.positionMs(): number
api.player.durationMs(): number
api.player.playing(): boolean
api.player.rate(): number        // 当前播放速率
```

---

## `api.audio` — 音频读写（解码 / 编码 / 替换）

```ts
api.audio.getBuffer(): AudioBuffer | null
api.audio.encodeWav(buffer: AudioBuffer, startMs?: number, endMs?: number): Uint8Array
api.audio.replaceFromBytes(
  bytes: Uint8Array,
  opts: { filePath: string; name?: string; autoApply?: boolean },
): Promise<boolean>
```

- `encodeWav`：转 16-bit PCM WAV 字节；给定 `startMs/endMs` 时只编码该区间。
- `replaceFromBytes`：解码 `bytes` 并**替换当前音频**（刷新波形、重链路径、重算 MD5、重跑分析）。
  `autoApply` 默认 `false`，避免自动 BPM/打点覆盖用户的表。
- **注意：替换音频不进入撤销栈**（撤销只能恢复工程数据，音频需手动回退）。

---

## `api.events` — 事件订阅

```ts
api.events.on(
  name: "project" | "selection" | "playhead" | "playing" | "view",
  cb: (payload?: unknown) => void,
): () => void   // 返回取消订阅函数
```

- `project`：工程数据变化（节流到微任务）。
- `selection`：选区变化。
- `playhead`：`payload` 为当前播放位置(ms)。
- `playing`：`payload` 为播放状态(bool)。
- `view`：时间轴滚动 / 缩放 / 尺寸变化（按帧节流）——叠加层据此重绘。

---

## `api.timeline` — 只读时间轴换算

```ts
api.timeline.timeToScreenX(ms: number): number   // 时间 → 编辑器内屏幕 x(px)
api.timeline.screenToTime(x: number): number      // 编辑器内屏幕 x → 时间(ms)
api.timeline.timeToX(ms: number): number          // 时间 → 内容坐标 x(未滚动)
api.timeline.viewport(): { x; y; vw; vh; pxPerSec }
api.timeline.durationMs(): number                 // 当前音频时长(ms)，无音频为 0
```

---

## `api.ui` — 界面贡献

### `registerAction`

```ts
api.ui.registerAction(def: { label: string | LocaText; run: () => void | Promise<void> }): () => void
```

出现在顶部「插件」菜单。

### `registerPanel`

```ts
api.ui.registerPanel(def: {
  id: string;
  title: string | LocaText;
  mount: (el: HTMLElement) => void | (() => void);
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
}): PanelHandle

interface PanelHandle {
  uid: number;
  dispose: () => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}
```

浮窗面板：可拖动、右下角可缩放。**位置与尺寸按「插件 + 面板 id」自动记忆**并在重启后恢复；
`defaultWidth/Height` 为首次打开的初始尺寸，`minWidth/Height` 为缩放下限。`mount(el)` 返回可选清理函数。

> 注册面板会自动生成菜单项，**不要再 `registerAction` 重复开关同一个面板**。

### `registerShortcut`

```ts
api.ui.registerShortcut(def: {
  id: string;
  label: string | LocaText;
  combo: string;   // 例如 "Alt+1"、"Ctrl+Shift+F"、"F5"
  run: () => void | Promise<void>;
}): () => void
```

### `registerImporter` / `registerExporter`

```ts
api.ui.registerImporter(def: { label: string | LocaText; run: () => void | Promise<void> }): () => void
api.ui.registerExporter(def: { label: string | LocaText; run: () => void | Promise<void> }): () => void
```

分别出现在「文件 → 导入…」与「导出 → 插件导出」。

### `registerTimelineOverlay`

```ts
api.ui.registerTimelineOverlay(def: {
  id: string;
  mount: (el: HTMLElement) => void | (() => void);
  z?: number;   // 层内堆叠顺序
}): () => void
```

在时间轴视口内挂载 `position:absolute; inset:0; pointer-events:none` 的容器。要点：

- 需要交互的子元素自行设 `pointer-events:auto`，并在 `pointerdown/move/up` 中
  `stopPropagation()`（配合 `setPointerCapture`），否则事件会穿透到下方画布触发编辑器操作；
- 用 `api.timeline.*` 换算坐标，订阅 `api.events.on("view", …)` 跟随滚动 / 缩放重绘。

### `registerBarButton`

```ts
api.ui.registerBarButton(def: {
  id: string;
  title: string | LocaText;
  icon?: string;        // 内联 SVG 字符串
  toggle?: boolean;     // true：点击翻转 active 并传入 run(active)
  active?: boolean;     // toggle 的初始按下态
  order?: number;       // 排序，越小越靠左
  run: (active: boolean) => void | Promise<void>;
}): BarButtonHandle

interface BarButtonHandle {
  uid: number;
  dispose: () => void;
  setActive: (v: boolean) => void;
  isActive: () => boolean;
}
```

在工程栏快捷行（`pb-quick`）注册小按钮。

### 面板开关

```ts
api.ui.openPanel(uid: number): void
api.ui.closePanel(uid: number): void
```

---

## `api.trackTypes` — 类型化轨道

```ts
api.trackTypes.register(def: {
  id: string;                 // 插件内唯一，不含 ":"
  trackName: string | LocaText;
  pointName: string | LocaText;
  color?: string;
  fields: Array<{
    key: string;
    label: string | LocaText;
    type: "number" | "string" | "bool" | "enum";
    default?: number | string | boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ value: number | string | boolean; label: string | LocaText }>; // enum
  }>;
}): { ok: boolean; reason?: string }
```

注册后侧栏「＋」可创建该类轨道，点在属性卡里编辑字段。轨道 `type` 为 `"<pluginId>:<id>"`，
点字段存于 `attrs`。内置导出不包含类型化轨道，插件导出自行读取。

---

## `api.system` — 文件 / 窗口服务

```ts
api.system.pickFile(opts?: {
  title?: string;
  filters?: FileFilter[];      // FileFilter = { name: string; extensions: string[] }
}): Promise<string | null>     // 绝对路径，取消为 null

api.system.saveFile(opts: {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
}): Promise<{ canceled: boolean; filePath?: string }>

api.system.readText(path: string): Promise<{ canceled: boolean; filePath?: string; content?: string }>
api.system.writeText(path: string, content: string): Promise<boolean>

api.system.readBytes(path: string): Promise<Uint8Array | null>
api.system.writeBytes(path: string, bytes: Uint8Array): Promise<boolean>

api.system.openWindow(opts: { url: string; title?: string; width?: number; height?: number }): Promise<void>
api.system.openPluginsFolder(): Promise<void>
api.system.audioPath(): string | null    // 当前加载音频的绝对路径
```

---

## `api.storage` — 持久化配置存储

按插件隔离、由主进程写入 `<userData>/plugin-data.json` 的键值库（**替代 `localStorage`**）。

```ts
api.storage.get<T>(key: string, def?: T): T   // 缺省 def
api.storage.set(key: string, value: unknown): void
api.storage.remove(key: string): void
api.storage.all(): Record<string, unknown>
api.storage.clear(): void
```

同步读写（像 `localStorage`），写入合并后稍后落盘，插件卸载时自动 flush。仅适合配置 / 偏好等
小数据，大块内容请走文件。

---

## `api.callMain` — 调用插件主进程

```ts
api.callMain(method: string, ...args: unknown[]): Promise<unknown>
```

调用本插件 `main.js` 中 `ctx.registerHandler(method, fn)` 注册的处理函数。

---

## main.js 入口（主进程）

在主进程加载，拥有完整 Node / Electron 能力。`activate` 必须**同步**。

```js
module.exports = function activate(ctx) {
  ctx.id;                               // 插件 id
  ctx.dir;                              // 插件目录绝对路径
  ctx.log(...args);                     // 日志
  ctx.registerHandler("ping", (...a) => "pong");  // 供 api.callMain("ping", ...) 调用
  ctx.onDispose(() => { /* 清理 */ });
};
```

---

## 类型速查

- `LocaText = string | { zh?: string; en?: string; [locale: string]: string }`
- `FileFilter = { name: string; extensions: string[] }`
- `LoopConfig = { interval: number; count: number; exclude?: number[] }`
