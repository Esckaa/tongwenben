# Edge 加载项上架清单

## 0. 注册开发者账号

官方文档：

- 注册：https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/publish/create-dev-account
- 发布：https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/publish/publish-extension
- 入口：https://partner.microsoft.com/dashboard/microsoftedge/public/login

要点（以官方页面当前要求为准）：

- **注册免费**，官方文档明确写“向 Microsoft Edge 计划提交扩展不收取注册费”。
- 需要一个 **Microsoft 账户（MSA）**：Outlook / Live / Hotmail；工作或学校账户不支持注册 Edge 计划。
- 没有 MSA 时，可以用 GitHub 账户登录 Partner Center 创建一个。
- 注册时填：
  - **Account country/region**：选中国；**注册后不可改**。
  - **Account type**：个人开发者选 **Individual**（公司才需要公司审批者、法定信息）。
  - **Publisher display name**：商店显示的发布者名，建议 `Esckaa` 或 `同文本检索`，最长 50 字符。
  - 联系人信息、开发者协议。
- 提交后等验证邮件；可能需要几天，检查垃圾箱。
- 验证通过后，Partner Center → Microsoft Edge → 新建扩展提交。

## 1. 当前素材

| 素材 | 路径 | 状态 |
|---|---|---|
| 安装包 | `dist/tongwenben-1.0.0.zip` | 已有 |
| 商店徽标 300×300 | `store/logo-300.png` | 已有 |
| 截图 1 主面板 | `store/screenshots/01-panel.png` | 已有，1280×800 |
| 截图 2 悬停变深 | `store/screenshots/02-hover.png` | 已有，1280×800 |
| 截图 3 设置页 | `store/screenshots/03-options.png` | 已有，1280×800 |
| 截图 4 PDF | `store/screenshots/04-pdf.png` | 已有，1280×800 |
| 短/长描述 | `store/listing.md` | 已有 |
| 权限与隐私问卷 | `store/permissions.md` | 已有 |
| 隐私政策 URL | https://esckaa.github.io/tongwenben/privacy.html | 已上线 |
| 公开演示页 | https://esckaa.github.io/tongwenben/demo.html | 待部署 |
| 支持邮箱 | — | **待填写** |

截图为 1280×800 PNG，符合官方“640×480 或 1280×800，最多 6 张”的要求；徽标 300×300，满足“建议 300×300、最小 128×128”。

## 2. Partner Center 字段对照

| 字段 | 填什么 |
|---|---|
| 扩展名称 | 同文本检索（来自 manifest，自动带出） |
| 简短说明 | manifest 的 `description`，自动带出 |
| 详细说明 | 复制 `store/listing.md` 的“详细说明” |
| 扩展徽标 | `store/logo-300.png` |
| 屏幕截图 | 4 张，按 01→04 顺序 |
| 分类 | 效率 / Productivity |
| 语言 | 中文（简体） |
| 隐私政策 URL | https://esckaa.github.io/tongwenben/privacy.html |
| 网站 | https://github.com/Esckaa/tongwenben |
| 支持邮箱 | **待填写** |
| 搜索词 | 同文本、重复文本、查找相同文字、文本检索、网页查找、PDF 查找、英语阅读、校对 |
| 可见性 | Public |
| 市场 | 所有市场（或至少中国 + 主要英语市场） |

可选素材（不强制，暂未做）：

- 小型促销磁贴 440×280
- 大型促销磁贴 1400×560
- YouTube 视频

## 3. 提交步骤

1. 登录 Partner Center，进入 Microsoft Edge 计划。
2. 新建扩展 → 上传 `dist/tongwenben-1.0.0.zip`。
3. 可用性：Public；市场按需勾选。
4. 属性：分类、隐私政策、权限说明。
5. 商店一览：名称、简短说明、详细说明、徽标、截图、搜索词、支持邮箱。
6. 隐私问卷：按 `store/permissions.md` 的表格填写；`<all_urls>` 的用途要写清楚。
7. 认证测试说明：复制 `store/permissions.md` 最后一节；公开演示页填 `https://esckaa.github.io/tongwenben/demo.html`。
8. 保存草稿 → 提交审核。
9. 等邮件；如被拒，按理由修改后重新提交。

## 4. 审核员测试路径

无需账号、无需登录：

1. 安装扩展，打开 https://esckaa.github.io/tongwenben/demo.html
2. 选中「人工智能」→ 应显示 3 处结果，页面浅色标出。
3. 鼠标移到文章中的另一处命中 → 该处变深。
4. 点结果 → 跳转并保持高亮；Esc 回原位。
5. 点工具栏图标 → PDF 阅读器 → 拖入任意文字版 PDF → 选中文字 → 出现同样列表。
6. 断网测试：功能不受影响。

## 5. 上架后

- 商店会给出安装链接；把链接补进 README 和 GitHub 主页。
- 以后更新：改代码 → 升 `manifest.version` → `build-zip.ps1` → 新提交 → 审核。
- 保留 `CHANGELOG.md` 的版本说明，审核和用户都会看。

## 6. 提交前待办

- [ ] 填支持邮箱
- [ ] 确认发布者显示名（`Esckaa` / `同文本检索`）
- [ ] 部署 `docs/demo.html` 并确认可访问
- [ ] 注册 Partner Center 并完成验证
- [ ] 上传 zip、徽标、4 张截图
- [ ] 填写隐私问卷与认证测试说明
- [ ] 提交审核
