# 插件 API v2 设计与迁移

本文是插件接口 v2 的**权威说明**,同时作为组织内所有插件仓库的统一改造依据。
配套参考:[插件系统](./plugin-system.md) · [插件 API 参考](./plugin-api.md)。

> 状态:v2 首个切片已随宿主接口落地(版本协商 + `api.ui.notify` + `project` 查询
> helper + 统一 `LocaText`)。类型源以宿主仓库 `plugins/plugin-api.d.ts` 为准。

## 1. 目标

老接口的问题不在"设计错",而在**缺少单一类型源**与**几个高频能力**,导致每个插件
各自打补丁。生态小、数量可控,因此本轮做一次性收敛,并把"接口版本"这件事补上,
让以后任何破坏性变更都可协商、可提示、可回滚。

## 2. 版本协商

### 2.1 宿主侧常量

宿主在 `src/shared/plugin.ts` 声明:

```ts
export const PLUGIN_API_VERSION = 2;          // 宿主当前支持的插件 API 版本
export const PLUGIN_API_VERSION_FALLBACK = 1; // manifest 未声明时的假定版本
```

插件在 `manifest.json` 声明自己写于哪个版本:

```json
{
  "id": "dev.bdg.example",
  "version": "0.2.0",
  "apiVersion": 2,
  "engines": { "bdg": ">=0.4.0" },
  "main": "main.js",
  "renderer": "renderer.js"
}
```

### 2.2 规则

| 情况 | 行为 |
| ---- | ---- |
| 未声明 `apiVersion` | 视为 `1`(历史插件),正常加载 |
| `apiVersion ≤ PLUGIN_API_VERSION` | 正常加载;宿主负责保留兼容 shim |
| `apiVersion > PLUGIN_API_VERSION` | **列出但绝不加载**:`PluginEntry.compatible=false`, `error` 给出原因,设置页禁用开关 |
| `engines.bdg` 不满足 | 目前仅作为元数据存储/展示,**暂不强制**;留给插件市场做拦截 |

- `apiVersion` 必须是 ≥1 的正整数;非法值回退为 `1`。
- 不兼容插件的 `main.js` **不会**在主编加载,`renderer.js` **不会**在渲染层执行。
- 判定与拒绝发生在:主进程扫描、启用/重载、`readPluginRenderer`、渲染层 `loadRenderer`。

### 2.3 破坏性变更流程

1. 宿主把 `PLUGIN_API_VERSION` +1;
2. 旧方法**保留并打印弃用警告**,新增方法并行提供(至少一个 minor 周期);
3. 各插件逐个把 `apiVersion` 提到新值、改用新方法;
4. 确认全部迁移后,再删除旧方法(下一个 major)。

## 3. v1 → v2 变更清单

### 3.1 新增

- **`api.ui.notify({ message, type?, durationMs? })`**
  宿主内的瞬时提示条。`type` ∈ `info | success | warning | error`。取代插件里"注入
  DOM 造 toast / 回退 `window.alert`"的私有实现。
- **`api.project.markersOfType(typeKey)`**
  返回该类型化轨道(`<pluginId>:<localId>`)上的全部点(已按 hidden 过滤)。
- **`api.project.tracksOfType(typeKey)`** / **`api.project.trackById(id)`**
  类型/ id 直达轨道视图,免去 `snapshot()` 里手写 join / 二次遍历。

### 3.2 类型修正

- `LocaText` 统一为 `string | { zh?; en?; [locale]: string }`(此前 `plugin-api.d.ts`
  只接受对象,`api.ts` 内联 `string | Record<string,string>`,三处不一致)。
- `api.ui.registerBarButton` 正式进入 `PluginApi` 类型(此前运行时已有、声明缺失)。

### 3.3 约定(非类型层面,但一并统一)

- **一个面板一个菜单入口**:`registerPanel` 已自动生成菜单项,**不要再**用
  `registerAction` 重复开关同一面板。
- **不要用 `localStorage`**,用 `api.storage`。
- 查询类型化轨道的点用 `markersOfType`,不要再手写 `snapshot` 过滤。

## 4. 类型分发:git submodule

`plugin-api.d.ts` 的**唯一源**是宿主仓库 `plugins/plugin-api.d.ts`。每个插件仓库把它
作为 submodule 挂载到根目录同名文件:

```bash
git submodule add <宿主仓库 URL> vendor/plugin-api
git submodule absorbgitdirs
```

或在已有插件里:

```bash
git submodule add https://github.com/beat-data-generator/beat_data_generator.git vendor/bdg
# 然后把 vendor/bdg/plugins/plugin-api.d.ts 作为 vendor 引入
```

> 若后续抽出独立仓库(如 `bdg_plugin_api`),只需替换 submodule 地址,插件内引用路径不变。

- 升级:插件内 `git submodule update --remote`,再提交 submodule 指针。
- CI 校验:检查 submodule 指针是否指向宿主发布 tag,漂移即失败(见第 6 节)。
- `renderer.js` 顶部保留 `/// <reference path="plugin-api.d.ts" />` 以获得编辑器提示。

## 5. 每个插件的迁移清单

1. `manifest.json` 增 `"apiVersion": 2`(按需 `engines.bdg`)。
2. 更新 `plugin-api.d.ts` submodule 指针到本版。
3. 删除"开关面板"的冗余 `registerAction`(保留面板自身菜单项)。
4. 手写 toast → `api.ui.notify`。
5. 手写类型化轨道过滤 → `api.project.markersOfType` / `tracksOfType`。
6. 统一 `LocaText` 用法(标签既可是字符串,也可是 `{zh,en}`)。
7. 跑通:typecheck / 手动在宿主里加载验证。

## 6. 质量门

- 宿主:`npm run typecheck` 与 `npm run lint` 必须通过。
- 插件:CI 校验 `plugin-api.d.ts` 与宿主一致(建议统一由一个可复用 workflow 执行)。
- 冒烟:在宿主 dev 扫描根(`<宿主>/plugins`)或 `<userData>/plugins` 里实际加载,
  确认渲染层无报错、贡献项可见。

## 7. 已落地 vs 待办

- [x] 版本协商(宿主 + 渲染层拒绝不兼容)
- [x] `api.ui.notify`
- [x] `api.project.markersOfType` / `tracksOfType` / `trackById`
- [x] 统一 `LocaText`;`registerBarButton` 类型补全
- [x] `example-basic` 与模板示范 v2
- [ ] `engines.bdg` 强制校验(与市场联动)
- [ ] 插件仓库 submodule + 共享 CI
- [ ] `api.dom` 等公共 helper 是否上收(评估中)
