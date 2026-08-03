# CueDeck

CueDeck 是一个只在 Mac 本机运行的 HTML 演示提词工具。它把演示和讲稿放在两个独立窗口中，让 Zoom 只共享演示窗口。

## 使用

1. 打开 `CueDeck.app`，选择一个 `.html` 演示文件。
2. 直接逐页编写讲稿，或导入 Markdown。
3. 点击“开始演示”。
4. 在 Zoom 中只选择标题以 `CueDeck Presentation -` 开头的窗口。
5. 点击提词卡正文、下一步按钮、空格或右方向键继续；左方向键返回。
6. `Command+Shift+H` 可立即隐藏或恢复提词卡。

不要在提词卡可见时共享“整个桌面”或“屏幕区域”。macOS 26 无法保证任意悬浮窗在整屏共享中被可靠排除。

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

讲稿默认自动保存为与演示同目录、同文件名的 `.cue.md` 文件。HTML 原文件不会被修改。

## 本地开发

```bash
npm install --ignore-scripts
electron_config_cache="${TMPDIR:-/tmp}/cue-deck-electron-cache" node node_modules/electron/install.js
npm test
npm run build
npm run pack
```

项目路径含冒号，因此脚本直接调用本地工具入口，不依赖 `node_modules/.bin` 的 PATH 解析。
