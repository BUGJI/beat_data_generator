# 贡献指南

> English speakers: feel free to open an issue or PR in English — we can handle it. The checklist below is Chinese-only for now.

感谢愿意帮忙。这个项目还处在 `0.x` 公测阶段，接口和工程文件格式都可能变，改动前建议先开个 issue 聊两句。

## 你可以怎么参与

- **报 BUG / 提需求**：用 [issue 模板](https://github.com/BUGJI/beat_data_generator/issues/new/choose)，信息填全有助于定位。
- **提 PR**：修 BUG、做功能、改文档都欢迎。
- **写插件**：不用改主仓库，插件独立仓库托管在[官方插件组织](https://github.com/beat-data-generator)。
- **翻译 / 文案**：英文 README 与界面文案一直缺人手。

## 开发环境

要求 **Node.js ≥ 20.19** 与 npm。

```bash
npm install        # 安装依赖
npm run dev        # 开发模式（热重载）
npm run typecheck  # 类型检查（主进程 + 渲染进程）
npm test           # 单元测试（vitest）
npm run format:check
```

其余脚本（`build` / `dist:win` / `lint` / `format` 等）见 [README 开发小节](README.md#开发)。

## 代码风格

- TypeScript / TSX 走 **Biome**（`npm run lint`、`npm run lint:fix`）；`.vue` 走 **Prettier**（`npm run format`）。
- 注释写“为什么”，不写“做什么”。
- 改界面文案时，同步更新 `src/renderer/src/i18n/zh.ts` 与 `en.ts`；README 有行为变化也要中英同步。
- 状态放 `stores/`、业务编排放 `services/`、主进程能力走 `preload/` 暴露的 IPC，不要绕过既有分层。

## 测试

- 测试框架是 vitest，目前覆盖纯逻辑层：`tempo.ts`、`schemas/project.ts`、`shared/settings.ts`、`services/history.ts`、`services/projectIO.ts`、`theme.ts`、`stretch/`。
- 新增或改动纯逻辑时请补测试；提交前跑一遍 `npm test`。

## 提交与分支

- 分支命名：`feat/xxx`、`fix/xxx`、`docs/xxx`、`chore/xxx`。
- 提交信息带前缀：`feat:` / `fix:` / `docs:` / `chore:` / `perf:` / `refactor:`，一句话说清做了什么。
- 一个 PR 只做一件事，避免顺带重构无关代码。

## Pull Request

- 说明动机、改动点与验证方式（跑过哪些命令、手测步骤）。
- 有界面改动请附截图或短录屏。
- PR 请先在本机跑通 `npm run typecheck` 与 `npm test`；CI 启用后（`.github/workflows/ci.yml`）会自动执行同样两项检查。

## 插件贡献

- 主仓库只保留示例插件 `plugins/example-basic` 与类型声明 `plugins/plugin-api.d.ts`，其它插件目录已在 `.gitignore` 中忽略。
- 正式插件请放到[官方插件组织](https://github.com/beat-data-generator)，从 [bdg_plugin_template](https://github.com/beat-data-generator/bdg_plugin_template) 起步。
- 插件需自带 `manifest.json`、`README.md`（说明安装方式、依赖与已知限制）。
- 新插件请在 README 的「导出与对接目标」表格里登记一行。

## 发布流程（维护者）

1. 更新 `package.json` 的 `version` 并提交。
2. 写 Release notes：中文为主，另附一段 **English summary**（历史 release 只有中文，后续请补上）。
3. `npm run dist:win` 生成 `release/Beat-Data-Generator-<版本>-setup.exe`。
4. 打 tag `vX.Y.Z`，在 GitHub Releases 上传安装包（连同 `*.blockmap`、`latest.yml`，供 `electron-updater` 自动更新使用）。
5. 同步更新 `CHANGELOG.md`。
6. 正式版发布时取消勾选 “Set as a pre-release”。

## 许可

本项目以 **GNU GPL v3** 发布（见 [`LICENSE`](LICENSE)）。提交 PR 即表示同意你的贡献以同一许可分发。
