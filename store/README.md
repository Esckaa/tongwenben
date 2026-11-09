# 商店素材

这个目录只放上架素材，**不会打进扩展 zip**。

## 文件

| 文件 | 用途 |
|---|---|
| `listing.md` | 商店文案：名称、简短/详细说明、分类、搜索词 |
| `permissions.md` | 权限对齐、隐私问卷答案、审核测试说明 |
| `checklist.md` | 注册与提交的逐项清单 |
| `logo-300.png` | 商店徽标 300×300 |
| `screenshots/01-panel.png` | 主面板：3 处命中、浅色高亮 |
| `screenshots/02-hover.png` | 悬停一处，该处变深 |
| `screenshots/03-options.png` | 6 套色系设置页 |
| `screenshots/04-pdf.png` | 内置 PDF 阅读器 |
| `demo.html` | 商店截图用的演示页（也被复制到 `docs/demo.html` 作为公开演示） |
| `capture.js` | 自动生成 4 张截图 |

## 重新生成截图

需要本地静态服务：

```powershell
node test/serve.js 8765
```

另开一个终端：

```powershell
node store/capture.js
```

脚本会：

1. 用无头 Edge 加载 `extension/`；
2. 1280×800、浅色模式；
3. 在设置页选蓝色；
4. 打开 `store/demo.html`，选中「人工智能」截主面板；
5. 悬停文章第二处命中截变深；
6. 打开 PDF 阅读器，载入 `test/fixtures/sample.pdf`，选中 `PDFTEST` 截 PDF；
7. 输出到 `screenshots/`。

Edge 路径默认 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，可用 `STS_EDGE` 覆盖。

## 素材规格

- 截图：1280×800 PNG，4 张（Edge 允许 640×480 或 1280×800，最多 6 张）。
- 徽标：300×300 PNG（Edge 建议 300×300，最小 128×128）。
- 详细说明：至少 250 字符，`listing.md` 已满足。
- 简短说明：来自 `manifest.json` 的 `description`，改文案时要同步改 manifest 并重新打包。
