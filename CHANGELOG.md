# 更新日志

本文件汇总各版本的主要变更；每条发布说明的完整原文见 [Releases](https://github.com/BUGJI/beat_data_generator/releases)。

版本号遵循语义化版本；`0.x` 阶段仍可能有破坏性改动（如工程文件 schema 升级）。

## [0.2.14] - 2026-09-21 · 公测版

- docs：更新 README 头部与截图位置
- 修复已知 BUG
- 安装包：`Beat-Data-Generator-0.2.14-setup.exe`

## [0.2.13] - 2026-09-20

- 修复：最小化后打拍音暂停、恢复窗口瞬间爆音（最小化时保持渲染帧与定时器运行；长时间挂起后的位置跳变做了保护，最多丢弃错过的打拍音）
- 注意：本次为补丁更新，包含主进程改动，需要重新安装生效

## [0.2.12] - 2026-09-20

设置面板

- 分类内新增二级子标签（编辑 / 音频 / 显示 / 高级），长页面拆分
- 「主题 → 自定义」的分享 / 导入移到顶部；「关于」独立为顶级分类并新增「检查更新」按钮

打拍音

- 改为文件夹形式：列表列出文件夹内所有打拍音，点选即用
- 点击即试听；新增独立音量（可关闭「跟随主音量」）
- 内置 3 款（Kick / Shaker / VehiclePositive），首次启动自动写入，随安装包分发

性能与交互

- 缓存 tempo map、按轨道分组的标记索引与内容长度，移除每帧重复的排序与过滤
- 波形逐像素绘制去掉逐像素的 store 读取与除法；框选高亮由 O(选中 × 标记) 降为单次遍历；拖动热路径合并多次全量扫描
- 属性卡打开时，点击卡片外只关闭卡片，不再误放踩点
- 颜色选择器增强：hex 输入、取色器、预设色

## [0.2.10] - 2026-09-17

- 修复「去除输入限制」开关；重新调整大部分输入限制
- 踩点编辑面板支持拖拽

## [0.2.8] - 2026-09-17

- 修复不变调播放听感卡顿（引入新的音频模块）
- 修复启动时播放偶发崩溃、播放中调整变速时卡顿
- 新增日志记录工具；修复设置表单存储一致性问题；框架优化，便于后续维护

## [0.2.0] - 2026-09-16

- 底层重构；统一界面样式并更换 UI 库
- 界面仍在优化，非最终版本

## [0.1.24] - 2026-09-16

- 修复会导致工程保存损坏的严重 BUG
- 修复若干已知问题

## [0.1.22] - 2026-09-16

- 新增主题功能：多套预设，支持自定义颜色
- 修复若干逻辑问题

## [0.1.19] - 2026-09-11

- 新增悬浮便签（支持 Markdown）
- 自动测 BPM：载入音频时检测速度，未锁定时写入 `baseBpm`
- 节拍打点：按检测到的拍位在独立「自动节拍」轨道放置标记
- 智能循环检测：`loop.detect` 找出最佳循环段落，在面板显示起止时间与置信度
- 实时 BPM：播放中定时用 `quickTempo` 刷新读数（不修改工程）
- 频谱分析面板：计算 `feature.melspectrogram` 并渲染 heatmap
- 设置列表分类整体优化

## [0.1.6] - 2026-09-10

- 新增「按住 Ctrl + 播放才变速」选项（默认关闭）
- 踩点轨道支持框选：按住左键拖动拉出选择框，可跨轨道
- 打拍音：可指定音频文件，多点重合时同时播放
- 鼠标中键拖动时间轴（等同 Shift + 滚轮）
- 多选时右下角显示所选踩点的起止毫秒区间
- 按住 Alt 拖动可临时关闭节拍网格吸附

## [0.1.0] - 2026-09-08 · 第一个公测版本

- 多轨道采音与完整的编辑工具集，可以无限趋近全量采音
- 轨道分类：分发使用者可按需做减法
- 插件系统：可导出几乎任何格式，也可新增专用轨道承载额外内容
- 定位说明：不是音游编辑器，也不是视频剪辑工具，目标是给其他编辑器提供一套标准的踩点基板

[0.2.14]: https://github.com/BUGJI/beat_data_generator/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/BUGJI/beat_data_generator/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/BUGJI/beat_data_generator/compare/v0.2.10...v0.2.12
[0.2.10]: https://github.com/BUGJI/beat_data_generator/compare/v0.2.8...v0.2.10
[0.2.8]: https://github.com/BUGJI/beat_data_generator/compare/v0.2.0...v0.2.8
[0.2.0]: https://github.com/BUGJI/beat_data_generator/compare/v0.1.24...v0.2.0
[0.1.24]: https://github.com/BUGJI/beat_data_generator/compare/v0.1.22...v0.1.24
[0.1.22]: https://github.com/BUGJI/beat_data_generator/compare/v0.1.19...v0.1.22
[0.1.19]: https://github.com/BUGJI/beat_data_generator/compare/v0.1.6...v0.1.19
[0.1.6]: https://github.com/BUGJI/beat_data_generator/compare/v0.1.0...v0.1.6
[0.1.0]: https://github.com/BUGJI/beat_data_generator/releases/tag/v0.1.0
