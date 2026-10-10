# Beat Data Generator 插件系统

插件用于扩展踩点编辑器:导入/导出新格式、数据生成与批量编辑、侧栏浮动静默面板、
自定义快捷键、独立预览窗口,以及针对特定游戏新增“类型化轨道”(如翻转事件),
它们与内置踩点共用同一条节拍时间轴。

> 完整的接口清单（命名空间 / 方法 / 类型 / 示例）见 [**插件 API 参考**](./plugin-api.md)。

## 插件形态

插件是一个文件夹,内含:

```
my-plugin/
├─ manifest.json    # 元信息(必需)
├─ main.js          # 可选:主进程入口(全 Node + Electron 权限)
├─ renderer.js      # 可选:编辑器页面内执行的脚本(注册 UI 贡献)
└─ …                # 插件自带的 HTML/静态资源
```

扫描目录:

- 用户目录 `<userData>/plugins`(设置页可一键打开);
- 开发模式下同时扫描项目根目录的 `plugins/`(示例插件放这里)。
- manifest 解析失败的插件会列在设置中并显示错误,不影响其余插件。

### manifest.json

```json
{
  "id": "dev.bdg.example-basic",
  "version": "0.1.0",
  "name": { "zh": "示例插件", "en": "Example Plugin" },
  "description": { "zh": "…", "en": "…" },
  "main": "main.js",
  "renderer": "renderer.js"
}
```

`name`/`description` 可为字符串或 `{ zh, en }`。`id` 建议反向域名风格且**不得含冒号 `:`**。

## renderer.js(UI 侧)

`renderer.js` 是普通脚本,通过全局注册函数声明入口。类型提示:

```js
/// <reference path="plugin-api.d.ts" />
window.__bdgPluginRegister(function activate(api) {
  // 在此注册所有贡献(见 PluginApi 类型)
  return function dispose() {
    // 卸载清理(取消订阅等)
  };
});
```

可以注册的贡献:

- `api.ui.registerAction({ label, run })` → 出现在顶部「插件」菜单;
- `api.ui.registerPanel({ id, title, mount, defaultWidth?, defaultHeight?, minWidth?, minHeight? })` → 浮动静默窗口(可拖动、右下角可缩放),`mount(hostEl)` 里用 DOM 自由渲染,返回可选清理函数;返回 `PanelHandle` 可 `open()/toggle()` 等。**窗口的位置与尺寸会按插件+面板 id 自动记忆**并在重启后恢复,`defaultWidth/Height` 只作为首次打开的初始尺寸,`minWidth/Height` 为缩放下限;
- `api.ui.registerShortcut({ id, label, combo, run })` → `combo` 形如 `Alt+1`、`Ctrl+Shift+F`;
- `api.ui.registerImporter({ label, run })` → 出现在「文件 → 导入…」;
- `api.ui.registerExporter({ label, run })` → 出现在「导出」菜单的“插件导出”分组;
- `api.ui.registerTimelineOverlay({ id, mount, z? })` → 在时间轴视口内叠加一层,用于可视化/拖拽(见下);
- `api.ui.registerBarButton({ id, title, icon?, toggle?, active?, order?, run })` → 在工程栏快捷行(`pb-quick`)加一个小按钮(见下);
- `api.trackTypes.register({ id, trackName, pointName, color?, fields })` → 新增类型化轨道,侧栏 `＋` 可创建,点在属性卡里编辑字段。

> 本系统**不提供“替换核心 UI”的能力**(插件无法接管/替换 Timeline、Transport 等宿主组件)。插件对界面的扩展方式只有浮窗面板与时间轴叠加层,宿主内部实现重构不会破坏插件。

> **菜单入口只保留一个**:注册面板(`registerPanel`)已自动在「插件」菜单生成一个带开合状态的菜单项,
> 因此**不要再用 `registerAction` 重复开关同一个面板**,否则会出现两个功能重复的入口。

### 时间轴叠加层

`api.ui.registerTimelineOverlay` 在时间轴视口内挂载一层 `position:absolute; inset:0;
pointer-events:none` 的容器,`mount(container)` 里用 DOM 自由绘制,返回可选清理函数。
用来把“区间选区、手柄、参考线”等贴到节拍时间轴上。

- **坐标换算**:用 `api.timeline.timeToScreenX(ms)` / `api.timeline.screenToTime(x)` /
  `api.timeline.timeToX(ms)` 在时间与像素间换算;`api.timeline.viewport()` 给出当前
  滚动与缩放(`x/y/vw/vh/pxPerSec`);`api.timeline.durationMs()` 为当前音频时长。
- **跟随缩放/滚动**:订阅 `api.events.on("view", cb)`(滚动、缩放、尺寸变化时触发,
  已按帧节流)重绘,否则叠加层不会随视口变化。
- **指针仲裁(重要)**:容器是 `pointer-events:none`,只有需要交互的子元素自行设
  `pointer-events:auto`;且这些元素在 `pointerdown/move/up` 里必须调用
  `stopPropagation()`(并用 `setPointerCapture`),否则事件会穿透到下方画布,触发
  编辑器的放置/拖拽。

### 插件持久化存储

不要在插件里用 `localStorage`(会被清缓存/E2E 环境清掉,且与其他插件混在一起,受同源限制)。
用 `api.storage` —— 一个按插件隔离、由主进程写到磁盘(`<userData>/plugin-data.json`)的键值库:

- `api.storage.get(key, def?)` / `set(key, value)` / `remove(key)` / `all()` / `clear()`;
- **同步读写**(像 localStorage),写入会被合并后稍后落盘;插件卸载时自动 flush;
- 数据按插件 id 命名空间隔离,插件之间互不可见。

```js
var snap = api.storage.get("snapDiv", 4);        // 读取,缺省 4
api.storage.set("snapDiv", 8);                    // 写入(自动持久化)
```

只适合存放配置/偏好等小数据,不要塞入大块内容(音频/工程数据请走文件)。

### 工程栏快捷按钮

`api.ui.registerBarButton` 在工程栏的快捷操作行(`pb-quick`)注册一个小按钮,适合
“一键开/关某功能”。`icon` 是插件自带的**内联 SVG 字符串**;`toggle: true` 时宿主在
点击后翻转按下态并把新值传给 `run(active)`,按钮随之高亮。返回的句柄可
`setActive(v)` / `isActive()` 编程控制与 `dispose()` 注销。

```js
var handle = api.ui.registerBarButton({
  id: "toggle-x",
  title: { zh: "功能 X", en: "Feature X" },
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="..."/></svg>',
  toggle: true,
  active: false,
  order: 100,
  run: function (active) { console.log("enabled:", active); },
});
// later: handle.setActive(true)
```

最小片段:

```js
var el = null;
api.events.on("view", function () {
  if (!el) return;
  el.style.left = api.timeline.timeToScreenX(2000) + "px"; // 时间轴上的 2s 处
});

api.ui.registerTimelineOverlay({
  id: "my-overlay",
  mount: function (host) {
    el = document.createElement("div");
    el.style.cssText = "position:absolute;top:0;bottom:0;width:2px;background:#f00";
    host.appendChild(el);
    return function () { el = null; host.textContent = ""; };
  },
});
```

## main.js(主进程侧)

在主进程加载,拥有完整 Node / Electron:

```js
module.exports = function activate(ctx) {
  ctx.log("loaded", ctx.dir);
  ctx.registerHandler("ping", () => "pong");
  ctx.onDispose(() => {});
};
```

渲染进程用 `api.callMain(method, ...args)` 调本插件注册的处理器。`activate` 需保持同步。

## 数据与工程文件

- 快照:`api.project.snapshot()` 一次给出节拍视角与 `timeMs` 时间视角(见字段)。
- 编辑一律走 `api.project.edit.*`,自动计入撤销栈;多步编辑用 `edit.batch(fn)` 合并为一次撤销。
- 循环组:主踩点可用 `edit.setMarkerLoop(id, { interval, count, exclude? })` 按「间隔拍数 × 个数」
  批量生成子点;第 k 个子点落在 `主点拍位 + k × interval`,与同轨道已有踩点重合的位置不生成。
  `count` 上限 **256**(超出按 256 处理),`exclude` 按 **1 起**编号跳过指定子点(如 `[2, 5]`
  跳过第 2、5 个)。传 `null` 清除循环并删除其子点;`id` 不是主踩点或所在轨道被锁定时
  该调用无效果。调用计入撤销栈,子点在快照里带 `parentId` 与 `loop` 字段。
- 类型化轨道:轨道带 `type: "<pluginId>:<localId>"`;点带 `attrs`,字段默认值在放置/粘贴时自动补齐,或由插件用 `setMarkerAttrs` 修改。
- 内置导出(.txt / EDL / 踩点指示灯)**不**包含类型化轨道;插件导出自行读取。
- `.bdg` 直接存 `type` + `attrs`,字段全可选、向后兼容。若保存的工程含某插件类型而该插件未安装:轨道与数据照常显示(点属性只读),属性卡提示需要安装对应插件。

## 渲染↔系统能力

编辑器渲染层是沙箱(`sandbox:true` + `contextIsolation`)。插件拿到的是受限桥接:

- 数据/编辑/播放/选区/事件、`api.timeline.*`(只读时间轴换算)、`api.system.pickFile/saveFile/readText/writeText/readBytes/writeBytes`、`openWindow(加载任意页面)`、`api.system.audioPath()`(当前加载音频的绝对路径，便于 main.js 用 Node 读取并打包)、`callMain`;
- **音频能力**:`api.audio.getBuffer()`(当前解码后的 `AudioBuffer`)、`api.audio.encodeWav(buffer, startMs?, endMs?)`(转 16-bit PCM WAV 字节)、`api.audio.replaceFromBytes(bytes, { filePath, name?, autoApply? })`(解码并替换当前音频,刷新波形/重链/MD5/分析;`autoApply` 默认 `false`)。注意**替换音频不进入撤销栈**。
- 需要任意 Node 能力时让插件自带 `main.js` 处理。本系统**不弹权限确认**,安装插件即视为信任。

## 示例

`plugins/example-basic` 覆盖:面板、快捷键、导入/导出、main 往返调用、类型化轨道注册、
`api.storage` 持久化（并按上文约定只保留一个菜单入口）。
音频裁剪插件（独立仓库 [`beat-data-generator/bdg_plugin_audiotrim`](https://github.com/beat-data-generator/bdg_plugin_audiotrim)）
演示时间轴叠加层 + 拖拽手柄 + `api.timeline` 换算、`api.audio` 编码/替换与 `system.writeBytes`。
开发时把工程目录当扫描根即可(见上),发布则把插件放入 `<userData>/plugins`（或从应用内插件市场安装）。

## 插件市场

设置 → 插件 → **插件市场** 提供应用内的一键安装/更新/卸载:

- 数据来自官方注册表 [`beat-data-generator/registry`](https://github.com/beat-data-generator/registry)
  的 `registry.json`（可用环境变量 `BDG_MARKET_REGISTRY` 覆盖地址）。
- 每个版本都带 SHA-256 校验和,安装前强制校验;产物为 HTTPS 下载的 ZIP,解压时
  会拦截路径穿越与超大文件。
- 市场安装的插件落在 `<userData>/plugins/<id>`,并写入 `.installed.json` 回执;
  只有带回执的插件才能从市场卸载,开发/手动放入的插件不受影响。
- 插件可获得完整 Node 权限,安装前请确认来源可信(界面会给出提示)。
- **缓存**:索引缓存在 `<userData>/market-cache.json`。进入市场优先读缓存,超过
  有效期(市场页可选 1 天 / 3 天 / 一周 / 一个月)才重新拉取;手动“刷新市场”
  始终重新拉取。网络失败时会回退到缓存。
- **网络设置**(设置 → 网络):代理来源可选 系统代理 / 读取环境变量
  (`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`) / 不使用;还可开启 GitHub 加速,
  从预设 gh-proxy 镜像中选择或自定义地址,并可一键测试各镜像延迟。
- **本地安装**:市场页“从 ZIP 安装”可选择一个本地 `.zip`(包根含 `manifest.json`),
  走与市场一致的解压/路径校验流程;来源记为 `file:<path>` 并写入安装回执。

### 市场品类

市场的分类芯片来自注册表条目的 `categories` 字段(字符串数组,小写 slug),
用于市场页顶部筛选与详情展示。约定使用以下固定品类(顺序即展示顺序):

| slug          | 中文 | 说明                                     |
| ------------- | ---- | ---------------------------------------- |
| `export`      | 导出 | 新增导出格式 / 导出目标                  |
| `import`      | 导入 | 导入新格式的数据                         |
| `integration` | 联动 | 与外部工具/进程联动、桥接                |
| `visual`      | 界面 | 界面外观、主题、可视化增强               |
| `utility`     | 工具 | 通用辅助工具、批量编辑                   |
| `analysis`    | 分析 | 音频/节拍分析等数据洞察                  |

- 一个插件可同时属于多个品类;未知 slug 仍会被列出并做首字母美化,但不会本地化。
  新增品类需同时更新 `src/shared/market.ts` 的 `MARKET_CATEGORIES` 与
  `settings.plugins.cats` 的 i18n 文案。
- slug 会被宿主统一转为小写、去空格并去重,因此注册表无需关心大小写与重复。

发布流程:插件仓库打 `vX.Y.Z` tag(与 `manifest.json` 的 `version` 一致)→
组织级工作流打包 `plugin.zip` 并创建 Release → registry 定时任务读取 Release
资产的 SHA-256 写入索引 → 应用内即可安装。详见
[bdg_plugin_template](https://github.com/beat-data-generator/bdg_plugin_template)
的 README。

## 常用命令

```bash
npm run typecheck   # 改动编辑器代码后跑类型检查
npm run build
```

## 许可与发布

- 你编写的插件属于你自己的作品(版权归你),可自行选择开源协议。
- 宿主编辑器 **Beat Data Generator** 以 **GNU GPL v3** 发布(作者 BUGJI)。插件由宿主加载器装载运行,分发插件时建议注明与宿主的关联。
- 官方插件模板/脚手架见 <https://github.com/beat-data-generator/bdg_plugin_template>。
