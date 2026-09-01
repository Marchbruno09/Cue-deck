# CueDeck

CueDeck 是一个只在 Mac 本机运行的 HTML / 本地网页 URL / PDF / PowerPoint 演示提词工具。它把演示和讲稿放在独立窗口中，让 Zoom 只共享演示内容。

## 使用

1. 打开 `CueDeck.app`，选择 HTML、PDF、现代 PowerPoint 演示文件，或连接本地网页 URL。
2. 直接逐页编写讲稿，或导入 Markdown。PowerPoint 会在首次导入时自动读取每页 speaker notes。
3. 点击“开始演示”。
4. 在 Zoom 中，HTML 和本地网页只共享标题以 `CueDeck Presentation -` 开头的窗口；PowerPoint 只共享其 Slide Show 窗口。
5. 点击提词卡正文、下一步按钮、空格或右方向键继续；左方向键返回。
6. `Command+Shift+H` 可立即隐藏或恢复提词卡。

不要在提词卡可见时共享“整个桌面”或“屏幕区域”。macOS 26 无法保证任意悬浮窗在整屏共享中被可靠排除。

## 本地网页 URL

- 在空白页点击“连接本地网页”，粘贴 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]` 地址。
- CueDeck 会在可共享的演示窗口中加载真实网页，不会把页面转换成图片；网页中的按钮、输入框、滚动和其他点击操作仍然可用。
- 提词卡继续使用 `.cue.md` 讲稿，URL 演示的讲稿副本保存在 CueDeck 的本机数据目录，也可以导出 Markdown。
- CueDeck 会向网页窗口发送左右方向键。支持标准 `.slide`、Reveal.js、`data-slide` 页面，以及 Bel Ontology Playground 的场景 URL。
- 本地网页服务必须在演示期间保持运行；CueDeck 只允许回环地址，避免把任意远程网页作为演示源加载。

## Markdown 格式

使用 `---` 分隔页面。每段的第一个 Markdown 标题会成为页面提示，其余内容作为讲稿：

```markdown
## 开场

先讲结论，再说明今天希望客户做出的决定。

---

## Why now

- 客户当前的变化
- 需要验证的证据
```

讲稿默认自动保存为与演示同目录、同文件名的 `.cue.md` 文件。演示原文件不会被修改。

## PowerPoint

- 支持 `.pptx`、`.pptm`、`.ppsx` 和 `.ppsm`；旧版 `.ppt` 需先在 PowerPoint 中另存为 `.pptx`。
- 首次打开时读取每页 speaker notes，并建立本机 `.cue.md` 讲稿副本。
- 已有 `.cue.md` 会被保留；“读取 PPT 备注”可主动用 PowerPoint 内备注刷新讲稿。
- 演示由 Microsoft PowerPoint 原生放映，CueDeck 根据实际页码同步提词，因此页内动画不会提前切换讲稿。
- 缩略图由 PowerPoint 和 macOS 本机组件生成并缓存在本机。首次使用时，macOS 会要求允许 CueDeck 控制 PowerPoint。

## PDF

- 支持标准 `.pdf` 文件，每个 PDF 页面会作为一页演示导入。
- 首次导入时使用 macOS PDFKit 在本机生成页面图像并缓存，不修改原始 PDF。
- PDF 演示在独立的 `CueDeck Presentation - 文件名` 窗口中显示，支持鼠标点击、空格、左右方向键和提词卡翻页。
- 讲稿保存在同目录的 `.cue.md` 文件中，也可以继续导入或导出 Markdown。

## 本地开发

```bash
npm install --ignore-scripts
electron_config_cache="${TMPDIR:-/tmp}/cue-deck-electron-cache" node node_modules/electron/install.js
npm test
npm run build
npm run pack
```

项目路径含冒号，因此脚本直接调用本地工具入口，不依赖 `node_modules/.bin` 的 PATH 解析。
