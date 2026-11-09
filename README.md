# 同文本检索（P1–P3）

选中页面里的一段文字，指针旁弹出一个列表，列出**当前页面所有完全相同的文本**；
点列表项就滚到那一处并高亮。Esc 先回到原来的位置，再按一次关闭。

完全一致一处都没有时，自动退一步：按关键词覆盖找最相近的 3 段，并标注相似度。

面向 Chromium（Edge / Chrome），Manifest V3，纯本地、不联网，只申请 `storage` 用来存设置。

## P2 新增

- **近似兜底**：零结果时按英文词 / 中文二元组算关键词覆盖，列出最相近的 3 段，带 `78%` 这样的相似度角标。整句题干只命中「它自己」时也按零结果处理，自动走兜底。
- **按标题分组**：结果按最近的 `h1–h6` 分段显示，长文里更好找。
- **浮层可拖拽**：按住标题栏（`⠿`）拖到任意位置；只有新一次选区才会重新定位到指针旁。
- **设置页**：扩展详情 →「扩展选项」，可开关兜底、开关分组、调整最多显示条数（50 / 100 / 200）。

## P3 进展

- **页面变化自动刷新**（2026-11-09）：面板开着时，页面新增/删除文本会在 450ms 防抖后重建索引并原地更新列表；结果没变不重绘，面板位置（包括拖拽后的位置）保持不变。
- **内置 PDF 阅读器**（2026-11-09）：点扩展工具栏图标，或设置页里的「打开 PDF 阅读器」，打开本地 PDF。PDF.js 渲染页面并生成可选中的文字层，选中文字后同样弹列表、跳转、高亮。

## 安装

1. 打开 `edge://extensions`（Chrome 是 `chrome://extensions`）。
2. 打开「开发人员模式 / 开发者模式」。
3. 点「加载解压缩的扩展」，选择本目录下的 `extension/`。
4. **如果要在本地 HTML 文件上测试**：进入扩展详情，打开「允许访问文件网址」。
   否则内容脚本不会注入 `file://` 页面。
5. 打开或刷新测试页。
6. PDF：点工具栏上的扩展图标，或进扩展选项点「打开 PDF 阅读器」。

## 手动验收

打开 `test/fixtures/demo.html`（英语阅读分栏页）：

| 验收项 | 操作 | 预期 |
|---|---|---|
| 跨标签命中 | 选中题干里的 `carbon dioxide` | 找到 4 处（含题干里选中的这一处），其中文章里那处是 `carbon <b>dioxide</b>`，被标签切断了 |
| 隐藏内容排除 | 选中题干里的 `the greenhouse effect` | 找到 5 处（题干 1 + 文章 4），不含末尾 `display:none` 那段 |
| 点击跳转 | 点列表第 3 条 | 页面滚到该处，橙色高亮 |
| 回原位 | 跳转后按 Esc | 回到选中时的滚动位置，面板还在 |
| 关闭 | 再按一次 Esc | 面板关闭，黄色高亮清除 |
| 悬停预览 | 鼠标移到列表项上 | 页面对应位置变橙色，但不滚动 |
| 键盘 | ↑ / ↓ / Enter | 切换、跳转 |
| 近似兜底 | 整句选中 Q2（`What is the main function of ...`） | 标题变成「没有其他完全一致 · 最相近的 N 段」，每条带百分比 |
| 拖拽浮层 | 按住面板标题栏拖动 | 面板跟着指针移动，松手停在原地 |
| 自动刷新 | 打开 `test/fixtures/live.html`，选中第一段加粗的 `watchme`，松开鼠标后**不要点页面**，等 2 秒 | 列表从 1 条变 2、3、4 条，面板位置不动；页面下方「当前高亮」同步变大 |

### PDF 阅读器

1. 点工具栏图标，或扩展选项 →「PDF 阅读器」→ 打开。
2. 点「打开 PDF」，选 `test/fixtures/sample.pdf`（也可以直接把 PDF 拖进去）。
3. 等页面渲染完成，选中第一段里的 `PDFTEST`。
4. 预期：弹出「找到 1 处」，可点击跳转、高亮；和网页里行为一致。

| 验收项 | 操作 | 预期 |
|---|---|---|
| 渲染与文字层 | 打开 `sample.pdf` | 显示 1 页，文字可选中、可复制 |
| 检索 | 选中 `PDFTEST` | 找到 1 处，点击后橙色高亮 |
| 缩放 | 点 `+` / `−` / 适合宽度 | 页面重新渲染，比例变化 |
| 换文件 | 再打开另一个 PDF | 旧页面清空，新文件从第 1 页开始 |
| 设置生效 | 扩展选项里关掉「按标题分组」 | 下一次选区，列表不再出现分组标题 |

打开 `test/fixtures/stress.html`：

| 验收项 | 操作 | 预期 |
|---|---|---|
| 总数与上限 | 选中任意一行里的固定短语 | 标题「找到 60 处」，列表 60 条 |
| 第 7 处 | 点第 7 条 | 滚到第 7 段 |
| 单字不弹 | 只选 1 个汉字 | 不弹面板 |
| 短词不弹 | 只选 2 个英文字母 | 不弹面板 |

## 自动测试

需要本机有 Edge。命令在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/run-harness.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File test/run-harness.ps1 -Page e2e.html
```

- 第一条跑 `test/harness.html`：文本索引、跨标签、块级边界、全半角、大小写、空白、隐藏、引号、上限、Range 映射、标题索引、近似兜底，共 32 项。
- 第二条跑 `test/e2e.html`：模拟五次真实选区（精确命中 + 跨段落近似兜底 + 整句题干只命中自己 + 唯一词 + 页面变化自动刷新），走完 索引 → 浮层 → 高亮 → 键盘跳转 → Esc 两级退出，共 20 项。
- 第三条把扩展**真正加载进浏览器**（需要先起本地服务）：

```powershell
node test/serve.js 8765
# 另开一个终端
powershell -NoProfile -ExecutionPolicy Bypass -File test/run-ext.ps1
```

它访问 `http://127.0.0.1:8765/test/ext.html`，检查 content script 是否注入、浮层是否创建、
`CSS.highlights` 是否在扩展的隔离世界里拿到 3 处命中。

PDF 阅读器有两条单独的自测（都需要 Edge，`pdf-cdp.js` 还需要先起上面的本地服务）：

```powershell
node test/pdf-cdp.js        # 普通页面模式：PDF.js 渲染 + 文字层 + 检索
node test/pdf-ext-cdp.js    # 真实扩展页：chrome-extension:// 下的 worker 与 CSP
```

前者用 `?pdf=...&test=1` 自动加载 `sample.pdf` 并选中 `PDFTEST`；后者按路径算出扩展 ID，
打开扩展内的阅读页，通过文件输入框塞入同一个 PDF。

当前结果：**32/32、20/20、扩展环境 HOST YES / ALL 3、PDF 阅读器 1 页 / 1 文字层 / 命中 1 处，全部通过**
（2026-11-09，Edge 157.0.4341.42 无头模式）。

脚本默认使用 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；
换浏览器或路径不同时加 `-Edge "C:\...\chrome.exe"`。

## 目录

```
extension/
  manifest.json
  options.html    设置页
  pdf-viewer.html PDF 阅读器
  src/
    textmap.js    文本索引：DOM -> 虚拟字符串 + 偏移映射 + 标题位置
    search.js     归一化（空白/大小写/全半角/弯引号）+ 精确查找
    fallback.js   近似兜底：关键词覆盖 + 句子级排序
    highlight.js  CSS Custom Highlight API 封装
    popup.js      Shadow DOM 浮层（可拖拽、分组、相似度角标）
    content.js    选区监听、索引缓存、跳转、Esc 状态机、设置同步
    options.js    设置读写
    pdf-viewer.js PDF.js 渲染、文字层、缩放、自测入口
    pdf-viewer.css
    background.js 工具栏图标打开阅读器
    page.css      ::highlight 规则（由浏览器注入，绕过站点 CSP）
    popup.css     浮层样式（加载进 shadow root）
    options.css   设置页样式
  vendor/pdfjs/   PDF.js 4.10.38（pdf.min.mjs / worker / LICENSE）
test/
  harness.html   核心逻辑自测
  e2e.html       端到端自测（页面内加载模块）
  ext.html       真实扩展联调页
  run-harness.ps1
  run-ext.ps1    把扩展加载进无头 Edge
  serve.js       联调用本地静态服务器
  pdf-cdp.js     PDF 阅读器自测（HTTP 模式）
  pdf-ext-cdp.js PDF 阅读器自测（真实扩展页）
  find-ext-id.js 未打包扩展 ID 探测
  fixtures/demo.html      英语阅读分栏演示
  fixtures/live.html      自动刷新验证页（会自己追加文本）
  fixtures/stress.html    60 处重复压力页
  fixtures/sample-src.html 生成 sample.pdf 的源
  fixtures/sample.pdf      1 页测试 PDF
```

## 已知限制

- 只检索**主文档已渲染的可见文本**：iframe、Shadow DOM、折叠内容、其他标签页都不在内。
- 近似兜底是**关键词覆盖**，不理解语义，也可能把不相干的句子排上来；它只是「找最像的」，不保证正确。
- 兜底最多给 3 条，只按覆盖率排序。
- 浏览器内置 PDF 阅读器读不到；Canvas 文档（Google Docs、腾讯文档）读不到。
- PDF 阅读器最多加载 60 页；加密或损坏的 PDF 打不开；不做注释、表单、链接跳转。
- PDF.js 是本地打包的（4.10.38），运行时不联网；许可证在 `vendor/pdfjs/LICENSE`。
- 虚拟列表只索引已渲染的行。
- 单次最多扫描 5000 个命中、高亮 600 处；展示条数默认 100，可在设置里改。
- 站点禁用 `::highlight` 时高亮失效（浮层仍可用）。

## 排错

- 打开控制台，过滤 `[STS]`：
  - `模块未加载` → 扩展没注入，检查是否在该站点启用、是否刷新过页面。
  - `不支持 CSS Custom Highlight API` → 浏览器太旧，只能看到浮层，看不到高亮。
- 面板出现了但没样式：`popup.css` 没取到，会退回内置的最小样式，功能不受影响。
- 设置改了没生效：设置页保存后即时生效，但需要**下一次重新选区**才会重新渲染列表。

## 下一步（P3 剩余）

- 大页面分片建索引，避免首次选区卡顿
- 同源 iframe 与 Shadow DOM
- 目标被折叠/隐藏时的更准确提示
- PDF 阅读器：懒渲染大文档、页面跳转与页码定位
