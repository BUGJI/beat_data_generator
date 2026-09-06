# Beat Data Generator

> 作者：**BUGJI** · 协议：**GNU GPL v3**

基于 **Electron + Vue 3 + TypeScript + Element Plus** 的音乐节拍踩点编辑器。在波形图上对齐歌曲节拍轴，放置踩点（beat marker）与 BPM 变速点，用于生成节奏类应用的节拍数据。

## 功能特性

- **音频加载**：支持 mp3 / wav / ogg / flac / m4a / aac / opus，实时绘制波形图。
- **节拍网格**：双轴（时间轴 + 节拍轴），以拍为单位吸附放置（1 ~ 1/32 拍细分）。
- **BPM 速度轨**：可放置 BPM 点（绝对 BPM 或倍数两种模式）构建变速（tempo map）；支持锁定 BPM。
- **多踩点轨道**：轨道可增删、重命名、换色、锁定与隐藏；隐藏轨道的踩点不计入播放指示灯与导出。
- **踩点编辑**：点击添加、拖动微调、右键删除；支持按吸附步进微调、多选（Ctrl/Cmd+点击）、全选。
- **循环组**：单个主踩点可按“间隔拍数 × 个数”批量生成子点，并可排除指定项；单个循环组最多生成 **256** 个子点以防编辑器卡死。
- **变速播放**：0.1–4 倍速播放；可选“变调跟随”或基于 soundtouchjs 的“保调变速”。
- **自动跟随**：播放时播放头越过阈值自动滚动跟随时间线。
- **撤销 / 重做**：最多 100 步历史；支持复制 / 粘贴踩点组（含循环）。
- **工程文件**：`.bdg`（JSON）保存，音频以相对路径记录并附带 MD5，重新打开时自动校验、自动重链。
- **导出**：时间戳列表 `.txt`（毫秒精度去重）与 **CMX3600 EDL** `.edl`（25fps non-drop）。
- **自动保存**：可配置间隔（1–60 分钟）后台自动保存当前工程。
- **其他**：多语言界面（中文 / English）、欢迎页与最近工程、记住窗口位置、退出模式设置、深色主题。

<img width="1000" height="650" alt="image" src="https://github.com/user-attachments/assets/79314d83-6f06-4afc-9e28-ccdd6d2c1f36" />

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron |
| 构建工具 | electron-vite / Vite |
| 前端 | Vue 3 + TypeScript |
| 组件库 | Element Plus + @element-plus/icons-vue |
| 国际化 | vue-i18n |
| 音频变速 | soundtouchjs |
| 波形绘制 | Canvas（自绘） |

## 项目结构

```
src/
├── main/            # Electron 主进程：窗口管理、IPC、文件对话框、设置/最近工程持久化
├── preload/         # 预加载脚本（contextBridge 暴露安全 API）
├── shared/          # 主/渲染进程共享的 IPC 类型定义
└── renderer/        # Vue 渲染进程
    └── src/
        ├── components/   # TopBar / SideBar / TransportBar / Timeline / SettingsModal / ProjectBar 等
        ├── i18n/         # 中英文案（zh / en）
        ├── store.ts      # 全局状态与业务逻辑（标记、轨道、BPM、历史、导入导出）
        ├── engine.ts     # Web Audio 播放引擎
        ├── tempo.ts      # 节拍 ↔ 时间换算与 tempo map
        ├── stretch.ts    # soundtouchjs 时间拉伸
        ├── editorView.ts # 视口 / 滚动 / 缩放模型
        └── metrics.ts    # 绘制度量与配色
```

## 开发

要求 Node.js（建议 ≥ 18）与 npm。

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 预览打包产物
npm start

# 构建
npm run build

# 类型检查
npm run typecheck
```

## 使用入门

1. 启动后从“文件”菜单 **打开音频**，波形将载入时间线。
2. 在 **BPM 轨** 点击放置 BPM 点（或直接在侧栏调整基础 BPM 与偏移）来对齐节拍网格。
3. 在 **踩点轨** 上点击添加踩点（自动吸附），拖动微调位置。
4. 播放验证踩点位置，可开/关自动跟随；需要时用变速 / 保调变速试听。
5. **保存工程**（`.bdg`）以保留踩点与 BPM 数据；或直接 **导出时间戳 / EDL**。

## 键盘快捷键

| 按键 | 功能 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| Ctrl+S | 保存工程 |
| Ctrl+C / Ctrl+V | 复制 / 粘贴踩点组 |
| Ctrl+Z / Ctrl+Shift+Z | 撤销 / 重做 |
| Delete | 删除选中对象 |
| ← / → | 按吸附步进左右微调（选中时） |
| Esc | 关闭浮动卡 / 取消选择 |
| Home | 回到起点 |
| Ctrl+滚轮 | 缩放时间线（悬停时间线上时） |

## 导出格式说明

- **时间戳 (.txt)**：每行一个浮点毫秒时间戳，保留 3 位小数，跨轨道同刻去重。
- **EDL (.edl)**：CMX3600 规格、25 fps、Non-Drop Frame，每点生成一个 1 帧事件，并带 `FROM CLIP NAME`。

## 许可

本项目以 **GNU GPL v3** 协议发布（详见 `LICENSE`）。作者：**BUGJI**。
