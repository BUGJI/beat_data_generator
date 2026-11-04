# Tauri 迁移方案

将本项目（Electron + Vue 3 + TypeScript）从 Electron 迁移到 **Tauri v2** 的评估与分阶段实施计划。

> 结论先行：这是一次**「重写外壳、保留渲染层」**的迁移，不是移植。渲染层（Vue / Pinia / Tailwind / reka-ui / i18n / 主题 / 波形 Canvas）基本可平移；主进程（17 个模块、43 个 IPC、插件宿主、市场、更新器、代理）需要重写。

- 动机：体积 / 内存 / 启动速度、去 Chromium 依赖与安全、Rust 后端性能、新增 macOS 支持
- 插件主进程入口（`main.js`）：**可接受降级为受限 API**
- 目标平台：**Windows 为主，Linux 同等重要，需新增 macOS**
- 最大不确定性：**Linux WebKitGTK 的 Web Audio / AudioWorklet / WASM 兼容性**

---

## 0. 目标架构

```
WebView (系统内核)              Rust 后端 (Tauri v2)
├─ Vue 3 / Pinia / Tailwind     ├─ command 层（替换 43 个 IPC）
├─ 波形 Canvas、主题、i18n       ├─ 文件/对话框/剪贴板/shell/通知（官方 plugin）
├─ engine.ts / stretch /        ├─ 市场下载+校验+解压（reqwest + sha2 + zip）
│  analysis.worker（Web Audio） ├─ 插件宿主（受限能力）+ settings/store
└─ window.api shim ─────────────┤─ 代理 / updater / logging
   (@tauri-apps/api invoke)     └─ 多窗口（main / welcome / plugin）
```

**核心原则**：渲染层代码尽量零改动。保留 `src/shared/ipc.ts` 的 `IpcApi` 接口，用一层 `window.api` 适配器把每个方法映射到 `invoke("command")`，使 `src/renderer/src/services`、`stores`、`components` 基本不动。

---

## 1. 模块映射表

| 现有 (Electron) | 目标 (Tauri v2) | 风险 |
| --- | --- | --- |
| `src/shared/ipc.ts`（43 方法） | 保留接口 + `src/platform/api.ts` shim → `invoke` | 中 |
| `src/preload/index.ts`（contextBridge） | 删除；shim 直接 import `@tauri-apps/api` | 低 |
| `src/main/ipc.ts` handlers | `src-tauri/src/commands/*.rs` | 中 |
| `dialog.showOpen/SaveDialog` | `tauri-plugin-dialog` | 低 |
| `node:fs` / `node:crypto`（md5、sha256） | Rust `std::fs` + `md-5` / `sha2` command | 低 |
| `clipboard` | `tauri-plugin-clipboard-manager` | 低 |
| `shell.openPath` | `tauri-plugin-shell`（opener） | 低 |
| `Notification` | `tauri-plugin-notification` | 低 |
| `app.getPath("userData")` | `app_data_dir()` / `app_config_dir()` | 低 |
| `process.resourcesPath` / `resources/metronomes` | `tauri.conf.json` 的 `bundle.resources` + path API | 低 |
| `electron-log` | `tauri-plugin-log` + 可选前端日志转发 | 低 |
| `src/main/windows.ts`（多窗口） | `WebviewWindow` 构建（main / welcome / plugin） | 中 |
| `session.setProxy`（`src/main/network.ts`） | 平台级代理参数（见 §4.3） | **高** |
| `electron-updater`（`src/main/updater.ts`） | `tauri-plugin-updater` + minisign + `latest.json` | **高** |
| `src/main/plugins.ts` main.js `require()` | 受限能力 API（无任意 JS 主进程） | **高** |
| `src/renderer/src/plugins/host.ts`（`new Function`） | 不变（CSP 放行 `'unsafe-eval'`） | 低 |
| `src/main/market/installer.ts`（`net.fetch` + unzip） | Rust `reqwest` + `zip`（或保留 `fflate`） | 中 |
| Web Audio / AudioWorklet / Worker | 不变，但需按引擎逐平台验证 | **高（Linux）** |
| `electron.vite.config.ts` | 保留 Vite；新增 `src-tauri/`（Rust + `tauri.conf.json`） | 中 |
| `electron-builder` | `tauri build`（NSIS / AppImage + deb / dmg） | 中 |
| `.github/workflows/*.yml` | 加 Rust 工具链 + Tauri 打包 + 签名 | 中 |

---

## 2. 分阶段实施

### Phase 0 — 可行性验证（PoC，建议 2–3 周）· 硬性 Go/No-Go 闸门

最小 Tauri v2 壳，加载现有已构建的 `out/renderer`，在三平台逐项验证**引擎能力**：

- `decodeAudioData`、Web Audio 播放、`AudioWorklet` + `signalsmith-stretch`（WASM，blob URL）
- `Worker`（soundtouch、`analysis.worker.ts`）+ `pleco-xa`
- 波形 Canvas、`URL.createObjectURL`、CSP `'unsafe-eval'`
- 记录各平台 WebView 版本下限：WebKitGTK（Linux）、WKWebView（macOS）、WebView2（Windows）
- 顺带量化体积 / 内存 / 启动收益

**退出条件**：Linux WebKitGTK 能跑通变速 + 分析。否则整个方案需重新评估，或 Linux 保留 Electron 双轨。这是全案最大不确定性。

### Phase 1 — 外壳 + IPC bridge（4–6 周）

- 建 `src-tauri`：Rust commands 一一映射 `IpcApi`；`src/platform/api.ts` 实现 shim，**保持 `window.api` 的 `IpcApi` 类型不变**。
- 接入官方插件：dialog / fs / clipboard / shell / notification / log / store / window-state / single-instance / os / process。
- 迁移 `settings.ts`、`recents.ts`、`lastDirs.ts`、`windowState.ts`、`files.ts`、`metronome.ts`、`i18n.ts`（主进程文案）。
- 多窗口：welcome 窗、plugin 窗、`welcomeAction` 交接、退出守卫（`setDirty` / `confirmQuit`）。

**退出条件**：渲染层不改业务逻辑即可打开音频 / 工程、保存、导出、主题、多语言全部跑通。

### Phase 2 — 插件系统迁移（3–4 周）

- `renderer.js`：沿用 `new Function` 宿主，零改动。
- `main.js`：**降级为受限能力 API**。删除任意 `require()`，把主进程能力收敛为固定 command（fs 读写、http、sha256、storage…），渲染层插件通过 `api.callMain` → 白名单 command。
- 破坏性变更：`PLUGIN_API_VERSION` 升到 **3**，旧 `main.js` 标记不兼容并给出提示。
- 市场：Rust 重写下载 / 校验 / 解压 / 原子替换 + 安装收据（`src/main/market/*` 逻辑平移）。
- 迁移官方插件仓库（adofai / phira / import / template）到新 API。

**退出条件**：插件市场安装、官方插件导入导出、面板 / 叠加层 / 快捷键全部可用。

### Phase 3 — 音频兼容性加固（2–3 周，承接 Phase 0 结论）

- 按引擎做能力探测与降级：优先 `signalsmith-stretch` → `soundtouchjs`；Worklet 不可用时回退 Worker / 主线程。
- 修复 Linux WebKitGTK 的采样率 / 延迟 / Worker 差异；必要时锁定系统 WebKitGTK 最低版本。

**退出条件**：三平台播放、变速、打拍音、分析面板一致。

### Phase 4 — 代理 / 网络 / 自动更新（2–3 周）

- 代理三态语义重做：WebKitGTK 走环境变量、WebView2 走启动参数、`off` 直连；`proxyMode` 设置项语义保留、实现分平台（**无法完全等价，需在 UI 说明差异**）。
- 市场 / 更新共用 Rust HTTP 客户端 + GitHub 镜像改写（逻辑不变）。
- Updater：生成并保管 **minisign 密钥对**，产出 `latest.json`，配置 `plugins.updater`；替换 `src/main/updater.ts`。

**退出条件**：静默 / 手动检查更新、下载、AppImage / NSIS 自更新可用。

### Phase 5 — 打包 / CI / 发布（2 周）

- Tauri bundler：Windows NSIS、Linux AppImage + deb、macOS dmg；图标 / desktop 元数据平移。
- 重写 `.github/workflows/release.yml`：verify(ubuntu) → package(win / linux / macos，加 Rust + 签名) → 发布（保留 CHANGELOG 抽取逻辑）。
- 签名：Windows 代码签名证书、macOS notarization（新增 macOS 的必需项）。

**退出条件**：`v*` tag 一键产出三平台安装包 + 更新清单。

### Phase 6 — 收尾（1–2 周）

- 文档（README / CONTRIBUTING / 插件系统文档）、许可清单（Tauri 为 MIT / Apache，与 GPL-3.0 兼容）。
- 回归 vitest / typecheck / lint；双轨期发布 Electron 版直到新版稳定。

---

## 3. 关键风险与缓解

1. **Linux WebKitGTK 音频（最高）**：Phase 0 先行验证；失败则 Linux 保留 Electron 或全案放弃。
2. **插件生态破坏**：`main.js` 降级是 breaking change —— 需版本协商 + 迁移官方插件 + 市场提示。
3. **代理语义不等价**：明确文档化，功能上做尽力映射。
4. **Updater 密钥 / 发布流程切换**：提前生成密钥、演练一次完整发布。
5. **多窗口 / 退出守卫重写**：Phase 1 单独回归。

---

## 4. 工作量与建议

- 总计约 **16–24 周**（1 人全职），其中 Phase 0 是决定性闸门。
- 收益成立：体积 / 内存 / 启动、去 Chromium、Rust 后端、统一 macOS —— 四点都能兑现。
- 最大代价集中在**插件主进程降级**与 **Linux 音频**；这两点必须在 Phase 0 / 2 拿到结论再投入后续。
- 若动机仅为体积 / 内存，可优先优化 Electron 打包，风险远小于迁移。

---

## 5. 无法等价兑现的能力（需产品决策）

| 能力 | Electron | Tauri | 影响 |
| --- | --- | --- | --- |
| 插件 `main.js` 全 Node 权限 | 支持任意 npm / `require` | 无 Node 运行时，仅受限 command | 破坏性，需迁移插件 |
| 运行时按 session 设代理 | `session.setProxy` 动态切换 | 仅平台级（env / 启动参数） | 语义降级 |
| 自动更新格式 | `latest.yml` + GitHub provider | `latest.json` + minisign 密钥 | 发布流程重做 |
| 内核一致性 | 全平台捆绑 Chromium | 各平台系统 WebView（差异大） | Linux 音频风险 |
