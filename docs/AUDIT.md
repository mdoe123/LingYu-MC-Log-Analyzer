# 项目审查报告

审查日期：2026-10-20
审查范围：`src/`、`test/`、`tools/`、构建配置、包元数据、文档与产物结构。

## 一、总体结论

项目的分层是清楚的：主进程负责文件、规则与模型调用，预加载只暴露白名单 IPC，渲染层不接触 Node；分析管线把「读取 → 解码 → 解析 → 规则 → 归因」拆成了独立模块，且纯函数比例较高，便于测试。

本次已完成英文名统一与几项一致性修复。剩余风险集中在四处：

1. 配置项与实际行为不一致（`useRuleEngine` 未接线）；
2. 测试夹具不可从干净仓库复现；
3. 端到端脚本没有断言，失败可能被当作成功；
4. 打包身份变更、未签名、仅 Windows x64。

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

| 位置 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| `src/shared/types.ts`、`src/main/settings.ts`、`SettingsDrawer.tsx` | `useRuleEngine` 只有定义、默认值与开关，`rules.ts` 从未读取 | 用户关闭开关后规则仍然执行，配置项“说谎” | 在 `runRules` 入口读取该设置；或直接移除开关与字段 |
| `.gitignore`、`test/make-fixture.cjs` | `test/fixture.zip` 被忽略，生成脚本只产出 `fixture-build/`，不负责压缩 | 干净仓库执行 `npm run test:pipeline` 必然失败 | 增加 `test:fixture` 脚本完成压缩（`yazl`/`archiver`/PowerShell），并在 `pretest:pipeline` 中自动生成 |
| `tools/e2e.cjs` | 仅打印结果，没有断言；`run-failed`、`LEAKED` 也以 0 退出 | 回归问题可能被忽略 | 对 `autoGuard`、`dirOk`、`launcherState` 等关键字段断言，失败 `app.exit(1)` |
| `src/main/index.ts`、`src/renderer/index.html` | `sandbox: false`；CSP 仍允许 `script-src 'unsafe-inline'` | 渲染层被攻破时缺少一层隔离；内联脚本策略偏宽 | 先尝试 `sandbox: true` 回归 preload/`webUtils`；生产 CSP 用 hash/nonce 收紧脚本 |
| 打包配置 | `appId` 由 `com.mclog.analyzer` 改为 `com.lingyu.mclog` | 与旧安装包不在同一升级链，不能原地升级 | 文档已注明先卸载旧版；若必须平滑升级，应保留旧 `appId` |

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
| 版本管理 | 无 `CHANGELOG`、无 git 仓库；版本号 0.1.0 | 初始化仓库并打 tag；发布前更新版本与变更记录 |

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
| `npm run test:pipeline` | 43 项检查全部 PASS |
| `npm run test:e2e` | 通过；`autoGuard` 正确拦截，目录分析 `dirOk=true`，启动器联动无回归 |
| `npm run dist` | 通过；产物名 `lingyu-mc-log-analyzer-0.1.0-*` |
| 打包启动 | 窗口标题「灵羽的MC日志分析器」；用户数据迁移成功 |
| asar 内容 | 仅 `out/`、`package.json`、3 个生产依赖；React 不再打包 |

## 七、建议的推进顺序

1. **P0**：接线或移除 `useRuleEngine`；补齐 fixture 生成；给 e2e 加断言。
2. **P1**：清理死代码与重复映射；拆分 `App.tsx` / `SettingsDrawer.tsx` / `index.ts`；引入 ESLint、Prettier、Vitest 与 CI。
3. **P2**：对齐 `@types/node`；代码签名与自动更新；macOS/Linux 构建；文档拆分与英文版。

审查结论：项目可以继续迭代，当前没有阻断发布的功能缺陷；但上述 P0 项会直接影响“设置是否可信”和“测试是否可复现”，建议优先处理。
