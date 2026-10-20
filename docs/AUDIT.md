# 项目审查报告

审查日期：2026-10-20
审查范围：`src/`、`test/`、`tools/`、构建配置、包元数据、文档与产物结构。

## 一、总体结论

项目的分层是清楚的：主进程负责文件、规则与模型调用，预加载只暴露白名单 IPC，渲染层不接触 Node；分析管线把「读取 → 解码 → 解析 → 规则 → 归因」拆成了独立模块，且纯函数比例较高，便于测试。

本次已完成英文名统一与几项一致性修复，P0 的前四项亦已在本轮修复（见第三节）。剩余风险：

1. 未签名、仅 Windows x64；
2. P1 的死代码与重复映射、缺少 lint / 单元测试框架 / CI。

## 二、命名统一（已完成）

英文名统一为 **LingYu MC Log Analyzer**，内部包名 `lingyu-mc-log-analyzer`。

| 位置 | 变更 |
| --- | --- |
| `package.json` | `name`、`author`、`description`、`engines` |
| `package-lock.json` | 根包名同步 |
| `electron-builder.yml` | `appId` → `com.lingyu.mclog`，`copyright` |
| `src/main/index.ts` | `setAppUserModelId`、窗口标题 |
| `src/main/migrate.ts`（新增） | 首次启动迁移旧 userData |
| `src/renderer/index.html`、`Header.tsx` | 中文显示名；版本号改为构建注入 |
| `README.md`、`docs/ARCHITECTURE.md` | 名称、包名、产物名、用户数据路径 |
| `LICENSE`（新增） | GPL-3.0 文本（与远端仓库一致） |
| `dist/` | 产物改为 `lingyu-mc-log-analyzer-*` |

旧名 `mc-log-analyzer` 仅保留在两处，且属于必要引用：`migrate.ts` 的旧目录常量，以及文档中的迁移说明。

## 三、发现的问题

### P0：影响正确性或可维护性

#### 已修复（本轮）

| 位置 | 问题 | 处置 |
| --- | --- | --- |
| `src/main/analysis/rules.ts`、`base.ts`、`src/main/index.ts` | `useRuleEngine` 只有定义、默认值与开关，`rules.ts` 从未读取 | **接线**：`runRules` 入口接收 `useRuleEngine`，为 `false` 时整体短路（无命中、无嫌疑、无关键词统计），并在 `notes` 中明确告知；设置经 `AnalyzeOptions` 从主进程传入，压缩包与目录两条路径都生效。文件清单、环境提取与阶段判定不受影响 |
| `test/make-fixture.cjs`、`package.json`、`.gitignore` | `test/fixture.zip` 被忽略且生成脚本不负责压缩 | **自动生成**：`make-fixture.cjs` 用 Node 标准库手写最小 ZIP（deflate + 中央目录，不引入 `yazl`/`archiver`，不依赖 PowerShell），同时产出 `fixture-build/` 与 `fixture.zip`；新增 `test:fixture`，由 `pretest:pipeline` / `pretest:e2e` 自动调用。`fixture.zip` 保持忽略、不入库 |
| `tools/e2e.cjs` | 仅打印结果，`run-failed`、`LEAKED` 也以 0 退出 | **加断言**：24 项断言，失败即 `app.exit(1)`。新增两条哨兵断言——`root` 有子节点（CSP 收紧后若拦下脚本会立刻失败）、`window.api.platform` 可用（`sandbox: true` 下 preload 与 `contextBridge` 仍工作）。负向验证过：把期望值改错后退出码为 1 |
| `src/main/index.ts`、`src/renderer/index.html` | `sandbox: false`；CSP 允许 `script-src 'unsafe-inline'` | **已加固**：`sandbox: true`；CSP 脚本策略收紧到 `script-src 'self'`。`style-src` 保留 `'unsafe-inline'`（Vite 开发模式以 JS 注入 `<style>`）。已验证：e2e 在 `out/` 下通过，打包产物（`app.asar`、`file://`）经 CDP 探测 `rootChildren=1`、`window.api.platform='win32'`、无 CSP 违规 |

#### 不再处理

| 位置 | 问题 | 结论 |
| --- | --- | --- |
| 打包配置 | `appId` 由 `com.mclog.analyzer` 改为 `com.lingyu.mclog` | 旧版本从未对外分发，不存在需要原地升级的存量安装，无需保留旧 `appId` |

### P1：代码质量与工程化

| 位置 | 问题 | 建议 |
| --- | --- | --- |
| `src/main/analysis/discover.ts` | `versionJsons` 收集后从未消费 | 解析 `versions/*.json` 补全 MC 版本/加载器，或删除该字段 |
| `src/main/analysis/base.ts` | 历史日志提示条件要求“有历史候选且未加载历史”，实际几乎不可达 | 修正提示条件；历史日志默认确实会加载，文案应改为“已包含历史日志” |
| `src/renderer/src/lib/format.ts` | `STAGE_META`、`CONFIDENCE_META` 导出但未被引用 | 删除或接入界面 |
| `discover.ts` / `base.ts` | 两份 `NOTE` 映射重复维护 | 抽到共享常量，避免新增类型时漏改 |
| `src/main/index.ts` | `analysis:run` 与 `analysis:run-dir` 重复守卫、应用默认值与上下文赋值 | 抽取 `runAnalysis(kind)` 统一处理 |
| `src/renderer/src/App.tsx` | 533 行，`runAnalysis` 重置状态块重复 | 抽 `useAnalysisSession` 或统一的 `resetSession()` |
| `SettingsDrawer.tsx` | 538 行，设置分组与状态逻辑集中 | 按分组拆子组件 |
| `src/renderer/src/lib/bridge.ts` | mock 重复实现分析与流式逻辑 | 抽 mock 运行器，减少与真实管线漂移 |
| `src/main/settings.ts` | 读取时只归一化 `launcher`，数值字段仅在写入时钳制 | 读取也做归一化，避免手改配置导致异常值 |
| 全仓库 | 无 ESLint / Prettier / CI；仅有 `typecheck` + 脚本测试 | 增加 lint/format 与 GitHub Actions（typecheck、pipeline、build） |
| `test/` | 无单元测试框架，纯函数（版本解析、规则、解码）依赖集成脚本 | 引入 Vitest，优先覆盖 `parseJavaVersion`、`normalizeArch`、`runRules` |

### P2：依赖、文档与结构

| 位置 | 问题 | 建议 |
| --- | --- | --- |
| `@types/node@^26` | 类型定义高于 `engines` 的 Node 22 | 对齐到 `@types/node@^22`，避免使用运行时不存在的 API |
| `electron-builder` 依赖链 | `npm audit`：生产依赖 0 漏洞，开发依赖 8 个 moderate | 跟进 builder 修复版本；不要在发布前执行破坏性 `audit fix --force` |
| 文档 | README 约 400 行，用户指南与开发说明混在一起；曾链接不存在的 `docs/AI_RESOLVER.md`（已移除） | 拆分「快速开始 / 使用 / 开发」；新增 CHANGELOG |
| `release/` | 改名前的旧产物仍在，约 960 MB；`dist/` 约 583 MB | 手动删除 `release/`；构建目录不入库、不长期保留 |
| `qwq/` | HMCL / PCL2 参考源码与发行包约 368 MB，已在 `.gitignore` | 移出项目目录，按需挂载，减少磁盘与检索噪声 |
| `README`、`docs` | 仅中文；`language` 只影响 AI 输出 | 如需英文用户，补 README.en.md 与界面 i18n |
| 版本管理 | 无 `CHANGELOG`；仓库已初始化并推送至 GitHub | 补 `CHANGELOG`；发布前打 tag |

## 四、配置一致性清单

| 项 | 现状 | 结论 |
| --- | --- | --- |
| 界面版本号 | `__APP_VERSION__` 由 Vite 从 `package.json` 注入 | 已修复，之前硬编码 `v0.2` 与 `0.1.0` 不一致 |
| 类型检查 | `npm run typecheck` 同时检查 node 与 web | 已修复，之前只查渲染层 |
| Node 版本 | `engines` 已声明 `^20.19.0 \|\| >=22.12.0` | 与 Vite / electron-vite / Electron 要求一致 |
| React 归属 | `react` / `react-dom` 移至 devDependencies | 已修复；asar 从 8.9 MB 降至 912 KB，包内不再包含 React |
| 许可证 | `license: GPL-3.0-only` 且 `LICENSE` 为 GPL-3.0 | 已补齐并对齐远端仓库 |
| 外链安全 | 仅 `http/https` 交给系统浏览器；阻止窗口内跳转 | 已加固 |
| 设置保存 | 返回值改为归一化后的设置 | 已修复，之前返回值与落盘值可能不同 |
| 设置与行为一致 | `useRuleEngine` 已接入规则引擎入口 | 已修复，之前该开关只影响界面展示 |
| 渲染进程隔离 | `sandbox: true` + CSP `script-src 'self'` | 已加固，之前 `sandbox: false` 且放行内联脚本 |
| 测试可复现 | `pretest:pipeline` / `pretest:e2e` 自动生成夹具 | 已修复，之前干净仓库必然失败 |
| 产物目录 | `dist/`；`release/` 为历史遗留 | 配置与文档一致，`release/` 待手动清理 |
| 显示名 vs 英文名 | `productName` 仍为中文「灵羽的MC日志分析器」 | 有意保留：Windows 显示中文，英文用于包名、产物与文档 |

## 五、依赖与构建状态

- 生产依赖仅 3 个：`chardet`、`iconv-lite`、`yauzl`；均由主进程外部化使用。
- `npm audit --omit=dev`：0 漏洞；全量审计：8 个 moderate，均在 `electron-builder` 开发链。
- Windows x64 产物：安装包与便携版各 107 MB；未签名，SmartScreen 会提示。
- 仅配置 Windows target；macOS / Linux 需在对应系统单独构建。
- 用户数据：`%APPDATA%\lingyu-mc-log-analyzer`，首次启动从旧目录复制 `settings.json` 与 `java-runtimes.json`。

## 六、验证记录

| 项目 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（node + web） |
| `npm run test:pipeline` | 54 项检查全部 PASS（含新增的 11 项规则引擎开关检查） |
| 干净仓库复现 | 删除 `test/fixture-build/`、`test/fixture.zip`、`test-dist/` 后直接 `npm run test:pipeline`，夹具自动重建并通过 |
| `npm run test:e2e` | 24 项断言全部 PASS；`autoGuard` 正确拦截，目录分析 `dirOk=true`，启动器联动无回归 |
| e2e 负向验证 | 故意改错一个期望值后退出码为 1，断言确实生效 |
| `npm run pack` / `dist` | 通过；产物名 `lingyu-mc-log-analyzer-0.1.0-*` |
| 打包启动 | 窗口标题「灵羽的MC日志分析器」；用户数据迁移成功 |
| 打包产物 CSP + 沙箱 | CDP 探测 `app.asar` 内 `file://` 页面：`rootChildren=1`、`window.api.platform='win32'`、无 CSP 违规 |
| asar 内容 | 仅 `out/`、`package.json`、3 个生产依赖；React 不再打包 |

## 七、建议的推进顺序

1. **P1**：清理死代码与重复映射；拆分 `App.tsx` / `SettingsDrawer.tsx` / `index.ts`；引入 ESLint、Prettier、Vitest 与 CI。
2. **P2**：对齐 `@types/node`；代码签名与自动更新；macOS/Linux 构建；文档拆分与英文版。

审查结论：四项 P0 已全部关闭，设置项与实际行为一致、测试可从干净仓库复现、端到端脚本失败即以非零码退出、渲染进程已沙箱化且脚本策略收紧。剩余项为工程化与分发层面的改进，不阻断继续迭代。
