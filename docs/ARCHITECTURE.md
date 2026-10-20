# 架构说明

本文描述灵羽的MC日志分析器（LingYu MC Log Analyzer，内部包名 `lingyu-mc-log-analyzer`）的内部结构：进程边界、IPC 契约、分析管线实现、证据包与提示词设计，以及扩展和二次开发的入口。

## 1. 技术栈

| 层 | 选型 | 版本 |
| --- | --- | --- |
| 桌面外壳 | Electron | 44.9.1 |
| 构建 | electron-vite / Vite | 6.0.0 / 8.3.4 |
| 主进程 | Node.js（TypeScript，ES2022） | — |
| 渲染层 | React | 19.3.1 |
| 类型 | TypeScript | 7.0.2 |
| 压缩包读取 | yauzl | 3.4.0 |
| 编码探测 | chardet + iconv-lite | 2.2.0 / 0.7.3 |

`electron.vite.config.ts` 分别配置 `main`、`preload`、`renderer` 三个构建目标；主进程与预加载使用 `externalizeDepsPlugin()`，依赖不打包进产物。

## 2. 进程模型

```
┌────────────────────────────┐        ┌───────────────┐        ┌──────────────────────────────┐
│ renderer (React)           │        │ preload       │        │ main (Node)                  │
│                            │        │               │        │                              │
│ App.tsx 状态机              │  IPC   │ contextBridge │  IPC   │ BrowserWindow                │
│ components/* 视图           │◄──────►│ window.api    │◄──────►│ ipcMain.handle(...)          │
│ lib/bridge.ts 双通道适配     │        │ (白名单方法)   │        │ analysis/* → 内存中完成分析    │
└────────────────────────────┘        └───────────────┘        └──────────────────────────────┘
```

- `src/main/index.ts`：创建 1220×820 窗口（`titleBarStyle: 'hidden'` + 覆盖层），注册全部 IPC，持有最近一次分析的上下文 `lastContext`。
- `src/preload/index.ts`：以 `contextBridge.exposeInMainWorld('api', api)` 暴露只读方法集合；`getPathForFile` 走 `webUtils`，因此拖拽路径不需要 `nodeIntegration`。
- `src/renderer`：纯浏览器环境代码，不得直接引用 Node 模块。桌面与浏览器预览的差异全部收敛在 `lib/bridge.ts`。
- `src/shared/types.ts`：唯一跨进程类型来源，同时承担 IPC 契约文档的职责。
- `src/main/launcher/*`：启动器配置的只读解析，不依赖 Electron API，可直接在 Node 测试中调用。

上下文隔离开启、`nodeIntegration` 关闭；`sandbox` 亦为关闭状态（`sandbox: false`）。窗口内 `window.open` 一律交给系统浏览器。

## 3. IPC 契约

| 通道 | 方向 / 方式 | 请求 | 响应 |
| --- | --- | --- | --- |
| `dialog:pick-archive` | invoke | — | `{ path, name, size } \| null` |
| `settings:get` | invoke | — | `Settings` |
| `settings:save` | invoke | `Settings` | `Settings`（原样回传；钳制仅作用于落盘内容） |
| `settings:test` | invoke | `Settings` | `SettingsTestResult`：`{ ok, latency?, error? }` |
| `analysis:run` | invoke | `AnalyzeRequest { path, name, size }` | `IpcResult<BaseAnalysis>` |
| `analysis:run-dir` | invoke | `DirAnalyzeRequest { path }` | `IpcResult<BaseAnalysis>` |
| `dialog:pick-game-dir` | invoke | — | `{ path, name } \| null` |
| `analysis:ai` | invoke | `AiRequest { trigger: 'manual' \| 'auto' }` | `IpcResult<AiAnalysis>` |
| `analysis:cancel` | invoke | — | `void`（中止当前 fetch） |
| `analysis:lines` | invoke | `LinesRequest { file, line, count? }` | `IpcResult<LinesResult>` |
| `analysis:progress` | main → renderer | `AnalyzeProgress` | — |
| `analysis:chunk` | main → renderer | `AiChunk`（`delta` / `status`） | — |
| `dialog:pick-launcher` | invoke | — | `{ path } \| null` |
| `launcher:get` | invoke | — | `LauncherProfile`（缓存值） |
| `launcher:refresh` | invoke | `LauncherIntegration?` | `LauncherProfile`（传入时即时解析，不落盘） |
| `java:list` | invoke | — | `JavaScanResult`（只读缓存，不触发扫描） |
| `java:scan` | invoke | — | `JavaScanResult`（只读枚举，单飞执行） |

约定与注意点：

1. `analysis:*` 不抛异常，统一返回 `IpcResult<T>`；`settings:*`、`dialog:*` 直接返回数据或抛错。渲染层需分别处理。
2. `analysis:ai` 有四个前置守卫，按顺序检查：无 `lastContext` → 已有进行中的 AI 请求 → `trigger === 'auto'` 且未开启 `autoAi` → 非 Ollama 且未配置 `apiKey`。任一条不满足即返回错误，不发起网络请求。
3. `analysis:cancel` 只中止 AI 请求（`AbortController`），基础分析不可取消。
4. `analysis:lines` 依赖 `lastContext.sources`，仅能读取本次已解析的文件；`count` 被钳制在 20–400，缺省 160。
5. `analysis:run` 会对扩展名、文件类型、压缩包体积做三道校验，任一失败直接返回错误文案。

## 4. 分析管线

`src/main/analysis/base.ts` 的 `analyzeArchive()` 是唯一编排入口，按压缩包 / 单文件两条路径分流。

```
analyzeArchive(path, name, size, onProgress)
│
├─ 单文件（.log / .txt）
│   extract 20 → 读全文件（≤48MB）
│   scan    45 → 判定 kind 并给出类型说明
│   decode  62 → 编码结果
│   parse   78 → 行数
│   rules   96 → 规则命中数
│   rules  100 → 完成
│
├─ 游戏目录
│   extract 10 → listGameDir 遍历（3 层 / 20000 条）
│   scan    30→36 → discover 分类
│   decode  36→60 → readFileCapped、可选 gunzip、解码、解析
│   parse   72 → 文件数
│   rules   94→100 → 规则命中、完成
│
└─ ZIP
    extract  8 → listZip 读中央目录
    extract 20 → 条目总数
    scan    36 → discover 分类（命中数 / 跳过数）
    decode  36→60 → 逐条读流、可选 gunzip、解码、解析
    parse   72 → 文件数
    rules   94 → 规则命中数
    rules  100 → 完成
```

进度百分比由 `onProgress({ stage, label, detail, progress })` 逐条推送；渲染层用 `stage` 映射到固定五阶段列表，用 `detail` 展示每阶段最后一条明细。

`analyzeArchive` 返回 `AnalyzeOutput { base, sources, modJars }`：

- `base`：可直接序列化给渲染层的 `BaseAnalysis`；
- `sources`：`{ file, log }` 数组，持有完整行与解析元数据，只留在主进程内存，用于证据跳转与 AI 证据块裁剪；
- `modJars`：mods 目录下的 jar 文件名。

`sources` 按 `fileKindRank` 排序：`crash → hs_err → latest → fml → debug → history → launcher → version_json → other`，使规则证据优先落在信息量最高的文件上。

## 5. 模块实现

### 5.1 `extract.ts` / `scan.ts` — 输入访问

- `listZip()`：`yauzl.open(..., { lazyEntries: true })` 逐条读取，归一化路径分隔符，丢弃三类条目：目录（以 `/` 结尾）、绝对路径、含 `..` 段的路径。条目数超过 `MAX_ENTRIES = 20000` 时关闭句柄并返回已有结果。
- `readEntry()`：按目标路径顺序扫描条目，命中后用 `openReadStream` 累积 Buffer；超过 `maxBytes` 时截断并立即结算，避免把超大条目读入内存。`settled` 标志保证 resolve / reject 只发生一次，关闭句柄时忽略错误。

目录来源由 `scan.ts` 承担：

- `looksLikeGameDir()`：探测 `logs` / `crash-reports` / `versions`，任一目录存在即视为游戏目录，否则在 IPC 层直接拒绝。
- `listGameDir()`：从根目录递归最多 3 层，跳过 `assets`、`libraries`、`runtime`、`saves`、`config` 等无关或体量大的目录，仅保留 `log/txt/json/jar/gz` 扩展名，最多 20,000 条；输出与 zip 条目同构的相对路径（正斜杠），因此能直接复用 `discover()`。
- `readFileCapped()`：`open` 后按 `stat.size` 与上限取较小值读取，`finally` 关闭句柄。

两条来源共用 `discover()` 与 `finalizeAnalysis()`，规则、评分、阶段判定与统计口径完全一致；差异只在读取层（zip 流式读取 vs 目录限长读取）与进度取值。

只做内存读取，不解压落盘，因此不存在解压炸弹造成的磁盘写入风险；内存侧由调用方的字节上限约束。

### 5.2 `discover.ts` — 文件分类与限额

`classify(path)` 返回 `{ kind, gzip }`，判定顺序（后者不会覆盖前者）：

1. `.jar` → `null`（mods 目录的 jar 在此之前已被单独收集）；
2. 剥离 `.gz` 得到 `stem`，后续一律匹配 `stem`；
3. `crash-YYYY-MM-DD*.txt` → `crash`；
4. `hs_err_pid<pid>.log` → `hs_err`；
5. `latest.log` → `latest`；
6. `fml-client-latest.log` / `fml-server-latest.log` → `fml`；
7. `debug.log` / `debug-N.log` → `debug`；
8. `YYYY-MM-DD-N.log` → `history`；
9. `hmcl*.log` / `pcl*.log` / `pcl2*.log` / `launcher*.log`，或路径含 `/hmcl/logs/` → `launcher`；
10. 其余 `.log` → `history`；
11. `versions/` 下的 `.json` → `version_json`（仅登记路径，不参与分析）；
12. 文件名含 `crash` 或 `崩溃` 的 `.txt` → `crash`。

每个类型有独立限额（`LIMITS`）与优先级（`PRIORITY`），同类按路径倒序取最近的若干份，最后按优先级全局排序。`skipped` 统计被忽略的条目数，用于进度明细。

### 5.3 `decode.ts` — 编码归一

顺序固定，命中即返回：

1. UTF-8 BOM（`EF BB BF`）→ 去 BOM 后按 UTF-8 解码；
2. UTF-16LE BOM（`FF FE`）→ `utf16le`；
3. `chardet.detect()` 判定为 UTF-8 且解码后无替换字符 `U+FFFD` → UTF-8；
4. 判定为 BIG5 → `iconv` BIG5；
5. 判定为 GB / GB18030 / EUC-CN → `gb18030`；
6. 兜底：先试 UTF-8，出现 `U+FFFD` 则改用 `gb18030`。

所有分支都会把 `\r\n` / `\r` 归一为 `\n`，避免行号与堆栈块在不同平台上错位。选择 `gb18030` 而非 `gbk` 是为了覆盖生僻字。

### 5.4 `parse.ts` — 行解析与堆栈块合并

行前缀识别三种形态：

| 形态 | 正则 | 提取 |
| --- | --- | --- |
| Forge / FML | `^\[([^\]]*)\]\s*\[([^\]]*)\]\s*\[([^\]]*)\]:\s?(.*)$` | 时间 / 线程+级别 / logger / 正文 |
| 括号 logger | `^\[([^\]]*)\]\s*\[([^\]]*)\]\s*\(([^)]*)\):\s?(.*)$` | 同上 |
| 通用前缀 | `^(?:\[[^\]]*\]\s*)+` | 保留正文，第二个方括号视为线程 |

级别从线程字段最后一个 `/` 之后提取（如 `Render thread/ERROR`），`WARNING` 归一为 `WARN`；提取失败时回退到正文中的 `/ERROR]`、`/WARN]`、`ERROR`、`WARN` 关键字。

堆栈块合并规则：

- **起始行**：不以 `at ` / `...` 开头，且满足其一——以 `Caused by:` / `Suppressed:` 开头，或正文包含 `XxxException` / `XxxError` / `XxxThrowable` 形式的全限定类名；
- **续行**：以 `at ` / `...` 开头，以 `Caused by:` / `Suppressed:` 开头，或以制表符 / 四个空格缩进；
- 单块最多吞并 80 行，遇到空行即终止；
- 块的 `index` 是数组下标，`startLine` 是还原后的 1-based 行号。

`MAX_LINES = 300000`：超出时丢弃头部、保留尾部，并记录 `lineOffset`，使 `lineNumberOf()` 仍能输出与原文一致的行号（这也是 `analysis:lines` 与证据行号能对齐的原因）。

### 5.5 `crash.ts` — 崩溃报告结构化

从报告中抽取六项：

| 字段 | 来源 |
| --- | --- |
| `description` | `^Description:\s*(.+)$` |
| `causedByChain` | 全部 `Caused by:` 行，去重保序；最后一条即根因 |
| `rootCause` | 链尾；无链时退化为异常类型 |
| `exceptionType` | 首个匹配 `*Exception/*Error/*Throwable` 的全限定名 |
| `firstForeignFrame` | 首个不在 `STACK_PREFIXES` 白名单内的 `at` 帧 |
| `modCount` | `^Mod Count:\s*(\d+)` |

`STACK_PREFIXES` 覆盖原版、Forge、NeoForge、Fabric Loader、Mixin、Mojang、JDK、LWJGL、Netty 等基础设施包名。白名单之外的第一个帧通常就是问题模组，因此它同时是「首个非原版帧」展示项与嫌疑评分依据。

`head` 固定截取前 45 行，供界面展示与 AI 证据包使用。

### 5.6 `rules.ts` — 规则、阶段与环境

三件事在同一模块内完成。

**(a) 规则匹配**：14 条静态规则（见 [RULES.md](RULES.md)）逐条扫描候选行。候选行的定义是：级别为 `ERROR` / `FATAL` / `WARN`，或正文包含 `Exception|Error|Caused by|Mixin|Missing|Duplicate|OutOfMemory`。每条规则最多收集 3 条证据，同一文件内行号相差小于 3 的锚点会被视为重复；证据正文优先取整段堆栈块（最多 14 行），否则取命中行前 2 行到后 6 行的窗口。

命中结果按严重级别升序排列（critical → low）。另外两条动态检查会插入列表前部：

- `hs_err`：存在 `hs_err_pid` 文件时插入，级别 critical，证据为文件前 12 行；
- `duplicate-mods`：mods 清单中同名模组出现多个版本时插入，级别 high。

**(b) 环境提取**：按「崩溃报告头部 → 日志前 400 行」的优先级匹配，覆盖启动器、加载器、MC 版本、Java 版本、系统、最大内存、模组数量。加载器识别顺序为 NeoForge（`--fml.neoForgeVersion` / `NeoForge:` 头）→ Forge（`--fml.forgeVersion` / `FML:` 头）→ Quilt → Fabric，最后用包名特征兜底并标注「版本未知」。

**(c) 阶段判定**：决策树见下表，`confidence` 表示该判定的证据强度，而非概率。

| 顺序 | 条件 | 结论 | 置信度 |
| --- | --- | --- | --- |
| 1 | 有崩溃报告，`Description` 命中 `ticking / server tick / saving / level / world / player` | 运行期 | high |
| 2 | 有崩溃报告，`Description` 命中 `initializ / constructing / loading / prepar / registry / mixin / rendering / starting` | 初始化 | high |
| 3 | 有崩溃报告，描述为空或无法归类 | 初始化 | medium |
| 4 | 存在 `hs_err_pid` | 运行期 | medium |
| 5 | `latest.log` 末 400 行含 `Sound engine started` / `Created: .*minecraft:textures` / `Stopping!` | 运行期 | medium |
| 6 | `latest.log` 末 400 行含 `Setting user` / `Reloading ResourceManager` / `Loading N mods` | 初始化 | medium |
| 7 | 只有启动器日志、没有游戏日志 | 启动器拉起 | high |
| 8 | 以上均不满足 | 无法判定 | low |

**嫌疑评分**：`buildSuspects()` 生成信号种子后按模组名（小写）合并，同名取最高分、理由拼接、去重后按分数倒序截取 8 个。分数含义是「可疑程度」，不是概率。

| 信号 | 分值 | 判定方式 |
| --- | --- | --- |
| Mixin 注入失败直接点名 | 72 | `Mixin apply for mod (\w+) failed` |
| 崩溃堆栈首个非原版帧命中 mods 清单 | 64 | 帧包名首段与 jar 解析名互相包含 |
| 日志声明缺少前置 | 55 | 含 `missing` / `requires` / `依赖` 的行中提取名称 |
| 同名模组多版本 | 50 | jar 名解析后按名称分组 |
| 首个非原版帧未匹配到 jar | 46 | 取帧的前两段包名，类型记为 `unknown` |
| 崩溃前最后加载的模组 | 12 | `Found mod file <name>.jar` 的最后一条（弱信号） |

jar 名解析（`parseJarName`）：去掉 `.jar` 后，找到第一个以数字开头的段作为版本起点，之前为名称；名称去掉 `-forge` / `-fabric` / `-neoforge` / `-quilt` / `-common` 后缀。例如 `geckolib-forge-1.20.1-4.4.4.jar` → `geckolib` + `1.20.1-4.4.4`。

### 5.7 `ai.ts` — 证据包与模型调用

**证据包构建**（`buildEvidencePack`）按固定小节拼接：

| 小节 | 内容 | 预算 |
| --- | --- | --- |
| 运行环境 | 7 项环境字段 | — |
| 本地规则判定 | 阶段 + 置信度 + 理由、日志统计 | — |
| 特征关键词统计 | 11 个关键词的命中次数与首次出现位置 | — |
| 规则命中 | 级别、标题、说明、证据位置 | — |
| 候选嫌疑对象 | 名称、版本、理由 | — |
| 崩溃报告 | Description、异常类型、完整 Caused by 链、首个非原版帧、报告头部 | 头部 2,400 字符/份 |
| 关键异常片段 | 按异常类型去重的堆栈块，每块 ≤18 行 | 单块 2,600 字符，块数 2–10 |
| 模组清单 | 前 120 个 jar 名 | 3,000 字符 |

异常块的取用顺序为 `latest → crash → debug → fml → 其他`，与 `sources` 的排序不同——给模型看的是「现场日志优先」。整体在拼接完成后按 `redact` 决定是否脱敏，最后截断到 `MAX_PACK_CHARS = 38000`。

**提示词设计**（`buildSystemPrompt`）：把领域经验写成 7 条硬约束——先判阶段、以崩溃报告为主、Caused by 链最后一条才是根因、向下找第一个非原版包名、无报告时依赖关键词、`hs_err_pid` 不按模组冲突解释、只用材料中出现过的模组名与版本（禁止编造），并要求修复建议可执行、冲突场景推荐二分法。输出被限定为单个 JSON 对象，字段与 `AiAnalysis` 一一对应。

**调用与容错**：

- 请求体固定 `stream: true`；`provider` 为 `deepseek` / `openai` / `moonshot` 时附加 `response_format: { type: 'json_object' }` 与 `stream_options: { include_usage: true }`。
- SSE 解析以 `\n` 切分并使用残留缓冲区，只处理 `data:` 行，忽略 `[DONE]` 与心跳；增量通过 `analysis:chunk` 推给界面，同时累积完整文本与 `usage`。
- 若服务端返回 `application/json`（不支持流式），走非流式分支，一次性回填。
- HTTP 错误映射为可读文案：401 → Key 无效、404 → 地址或模型名错误、429 → 频率或额度问题，其余拼接响应体前 200 字符。
- `parseAiJson` 先剥离 ```json 代码围栏，失败时取首个 `{` 到末个 `}` 再解析，仍失败则抛「模型返回的内容不是合法 JSON」。

**结果归一**（`toAiAnalysis`）不信任模型输出：`severity` 走白名单，`confidence` 钳制到 0–1，`fixes` 最多 6 条且级别非法时降级为 `try`，`components` 最多 10 个，`secondary` 最多 6 条。

**证据回填**（`hydrateEvidence`）是最关键的一层防护：模型只返回 `{ file, line, why }`，主进程据此在本地 `sources` 中重新取 6 行原文，并把 `why` 以 `# 注释` 追加在末尾；找不到文件或行号越界则整条丢弃。模型因此无法伪造日志正文，最多只能选错位置——而选错的位置仍可被人工核对。

### 5.8 `settings.ts` — 持久化

- 路径：`app.getPath('userData')/settings.json`。
- 写入：展开传入设置 → 钳制 `maxEvidence`（2–16）与 `maxArchiveMb`（10–4096）→ 删除明文 `apiKey` → 若 `safeStorage.isEncryptionAvailable()` 则写入 `apiKeyEnc`（Base64），否则回退明文。
- 读取：解析失败或字段缺失时回退默认值；解密失败时把 `apiKey` 置空而不报错，避免因系统密钥环变化导致应用无法启动。

### 5.9 渲染层

`App.tsx` 维护一个显式阶段机，`Phase` 定义在 `src/renderer/src/types.ts`：

| 阶段 | 视图 | 进入条件 | 可用动作 |
| --- | --- | --- | --- |
| `idle` | 拖拽首页 | 初始状态 | 选择文件、载入示例（仅浏览器） |
| `base` | 五阶段进度 | `analysis.run` 发起 | 无（等待） |
| `ready` | 基础结果 | `run` 成功 | AI 分析、换文件 |
| `ai` | 基础结果摘要 + 流式输出 | `analysis.ai` 发起 | 取消 |
| `done` | AI 结果 | `ai` 成功 | 重新分析、换文件、复制、导出 |
| `error` | 错误卡片 | `run` 失败 | 重新选择 |

状态通过 `setPhaseSafe` 同时写 ref 与 state，保证 `runAi` 在异步回调中读到的是最新阶段而非闭包快照。设置变更后由 `useEffect` 自动落盘（首次水合完成后才启用，避免用默认值覆盖用户配置）。

`lib/bridge.ts` 是双通道适配层：桌面版直接使用 `window.api`，浏览器版使用 `mockApi`——按阶段延时推进进度、分片吐出一段 JSON 模拟流式输出、从 `MOCK_LOGS` 返回示例行。新增 IPC 方法时必须同步补齐 `mockApi`，否则 `npm run dev:web` 会在运行时缺方法。

### 5.10 `launcher/*` — 启动器配置联动

| 文件 | 职责 |
| --- | --- |
| `launcher/index.ts` | 路径校验、类型判定、结果编排、`applyLauncherDefaults` |
| `launcher/pcl.ts` | 解析 PCL2 的 `PCL/Setup.ini` |
| `launcher/hmcl.ts` | 解析 `launcher-settings.json`、`game-directories.json` 与实例级配置 |

**启动时序**：

```
app.whenReady
  → registerIpc()
  → createWindow()
  → void refreshLauncherProfile()        // 异步读取，不阻塞窗口
settings:save
  → writeSettings()
  → void refreshLauncherProfile()        // 落盘后重新读取
analysis:run
  → readSettings()
  → 若 enabled 且缓存仍为 disabled：await refreshLauncherProfile()
  → analyzeArchive()
  → applyLauncherDefaults(base, profile)
```

`profileSeq` 是单调递增令牌：启动读取、设置变更、手动刷新可能并发，只有最后一次请求的结果会写入缓存，避免旧结果覆盖新配置。

**状态与影响**：

| state | 触发条件 | 对分析结果的影响 |
| --- | --- | --- |
| `disabled` | `enabled === false` | 无，且不产生任何文件读取 |
| `unconfigured` | 已启用但 `exePath` 为空 | 无 |
| `ok` | 至少解析出一个可用字段 | 补全 `environment.launcher` / `memoryMaxMb` |
| `error` | 路径无效、类型未识别、配置缺失或解析异常 | 无，按默认设置继续 |

**解析规则**：

- PCL2：`PCL/Setup.ini` 无分节，每行 `Key:Value`（按首个冒号切分）。`LaunchFolderSelect` 取游戏目录；`LaunchRamType === '1'` 时用 `LaunchRamCustom`（GB）换算 MB，自动分配模式不产生固定值。
- HMCL 3.16+：`selectedGameDirectory` 是目录 ID，需经 `config/game-directories.json` 的 `directories[].path` 映射；`selectedInstance[id]` 定位实例，再读 `<gameDir>/versions/<instance>/.hmcl/config/instance-game-settings.json` 的 `maxMemory` 与 `customJavaPath`。旧版回退 `hmcl.json` / `.hmcl.json` 的 `gameDir`、`javaDir`。
- 实例无法定位时，若只存在一个带实例配置的版本目录则采用它，否则跳过实例级字段并写入 `warnings`。
- 每个文件读取独立 `try/catch`：缺失或损坏转为 `error`，单字段异常转为 `warning`，不影响其余字段。

**应用语义**：`applyLauncherDefaults` 只填写日志未提供的字段，已有值不覆盖，并在 `notes` 中标注来源。补全发生在 `lastContext` 赋值之前，因此 AI 证据包中的「运行环境」也会带上这些默认值。

**边界**：不执行启动器、不修改其配置、不联网。当前版本没有游戏启动流程，该联动仅服务于分析上下文与后续功能的数据来源。

### 5.11 `java/*` — Java 运行时扫描

| 文件 | 职责 |
| --- | --- |
| `java/scan.ts` | 候选收集（环境变量、PATH、启动器、注册表、标准目录、游戏 runtime）、并发识别、去重、时间预算 |
| `java/identify.ts` | `release` 解析、版本/架构归一、可执行文件校验、超时探测 |
| `java/registry.ts` | `reg.exe` 查询 JavaSoft 与各发行版注册表键 |

**来源与顺序**：`JAVA_HOME` / `JDK_HOME` / `JRE_HOME` → 启动器解析出的 `javaPath` → `PATH` → Windows 注册表 → 标准安装目录 → `<gameDir>/runtime`。Map 以规范化路径去重，先到先得；最终再按 `realpath` 去重，识别失败时保留原路径。

**识别**：先读 `<home>/release` 的 `JAVA_VERSION`、`IMPLEMENTOR`、`OS_ARCH`，不执行二进制；缺失版本时才执行 `java -XshowSettings:properties -version`（单次 2.5 秒超时）。版本归一规则：`1.8.0_x` → 8，`17.0.8` → 17；架构归一为 `x86` / `x64` / `aarch64`。没有 `bin/java` 的目录保留为无效项并附 `error`。

**预算**：最多 120 个候选、总体 8 秒、并发 4；超时或触顶写入 `warnings`，不阻塞 IPC。扫描结果写入 `userData/java-runtimes.json`，`java:list` 只读缓存，应用启动时**不扫描**。

**边界**：便携版/重命名 JDK 无法保证发现；`reg.exe` 被安全策略禁止时该来源静默跳过；`java -version` 探测可能被杀软拦截；结果不是系统全量清单。

## 6. 安全与资源边界

| 边界 | 实现 |
| --- | --- |
| 路径穿越 | `isUnsafePath()` 拒绝绝对路径与 `..` 段；只在内存中读流，不落盘 |
| 条目数量 | `MAX_ENTRIES = 20000`，超出即停止枚举 |
| 单文件体积 | 48 MB 截断（`readEntry` 与单文件读取双处限制） |
| 总体积 | 160 MB，超出后中断循环并写入 `notes` |
| 行数 | 单文件 300,000 行，保留尾部 |
| 证据包 | 38,000 字符截断 |
| 网络 | 仅 `settings:test` 的 `/models` 探测与 `analysis:ai` 的 `/chat/completions`；无遥测 |
| 密钥 | `safeStorage` 加密存储，渲染层仅持有内存副本 |
| 启动器配置 | 只读 `stat` / `readFile`；不执行启动器、不写回配置、不联网；路径由用户显式选择 |
| 目录读取 | 只读 `open/read`，不写回；跳过无关目录；路径由用户显式选择 |
| Java 扫描 | 只读 `release` 与目录；仅在缺版本时执行 `java -version`（超时 2.5s）；不写回 JDK、不联网 |
| 渲染层权限 | `contextIsolation` + 白名单 IPC，无 Node 能力 |

## 7. 扩展指南

### 7.1 新增一条规则

在 `src/main/analysis/rules.ts` 的 `RULES` 数组中追加对象：

```ts
{
  id: 'my-rule',                       // 全局唯一，同时作为界面 key 与报告 id
  severity: 'high',                    // critical | high | medium | low
  pattern: /YourSignatureHere/i,       // 在候选行上逐行 test，勿带 g 标志
  title: '一句话结论',
  detail: '机制解释：为什么会报这个错，常见成因是什么。',
  fixes: [
    { level: 'immediate', title: '先做的动作', detail: '具体到菜单/文件名/参数。' },
    { level: 'try', title: '备选动作', detail: '…' },
    { level: 'diagnose', title: '排查手段', detail: '…' }
  ]
}
```

检查清单：

1. `id` 不与既有规则重复（`hs_err`、`duplicate-mods` 为保留 id）；
2. 正则不加 `g`（跨行复用时 `lastIndex` 会污染结果）；
3. 避免与既有规则语义重叠，例如 `NoClassDefFoundError` 已被 `classdef` 覆盖；
4. `fixes` 的第一条应是用户能立刻执行的动作，`diagnose` 放在最后；
5. 用 `npm run test:pipeline` 验证：新增规则应在夹具上命中或保持沉默，而不是产生无关证据。

### 7.2 新增一种日志类型

需要同步修改四处，缺一处就会出现类型不匹配或分类落空：

1. `src/shared/types.ts`：向 `LogFileKind` 联合类型追加字面量；
2. `src/main/analysis/discover.ts`：`classify()` 增加匹配分支，并补齐 `LIMITS`、`PRIORITY`、`NOTE` 三张表；
3. `src/main/analysis/base.ts`：补齐 `NOTE` 表与 `fileKindRank()` 的顺序数组；
4. 若该类型需要参与环境或阶段判定，在 `rules.ts` 的 `extractEnvironment` / `guessStage` 中读取对应 `sources`。

### 7.3 新增模型服务商

1. 在 `src/renderer/src/data/mock.ts` 的 `PROVIDERS` 中追加预设（`id`、`name`、`baseUrl`、`model`），设置抽屉会自动出现该选项；
2. 若该服务商支持 `response_format: json_object`，在 `src/main/analysis/ai.ts` 的 `callModel()` 中把 `id` 加入条件判断；不支持时不要加，否则会被服务端拒绝；
3. 若无需 API Key（如本地推理），在 `src/main/index.ts` 的守卫与 `App.tsx` 的 `runAi` 中同步放行，当前只对 `ollama` 特判。

### 7.4 调整证据预算

| 目标 | 修改点 |
| --- | --- |
| 放宽/收紧总长度 | `ai.ts` 的 `MAX_PACK_CHARS` |
| 改变异常块数量 | `ai.ts` 中 `errorBlocks(..., Math.max(2, Math.min(settings.maxEvidence, 10)))` |
| 改变单个块行数/字符 | `errorBlocks` 内的 `slice(0, 18)` 与 `clip(..., 2600)` |
| 改变崩溃报告头部长度 | `clip(crash.head, 2400)` |
| 改变脱敏规则 | `redact()` 中的正则链 |

调大预算会线性增加 token 消耗与首字延迟；在 32k 上下文模型上，38k 字符的证据包已接近安全上限。

### 7.5 新增 IPC 通道

按 `shared/types.ts`（契约）→ `preload/index.ts`（暴露）→ `main/index.ts`（实现）→ `renderer/lib/bridge.ts`（mock 同步）的顺序修改。类型签名写在 `AppApi` 接口中，TypeScript 会在预加载与 mock 两侧同时报错，这是最有效的契约校验。

## 8. 测试策略

| 层级 | 入口 | 覆盖内容 |
| --- | --- | --- |
| 管线测试 | `npm run test:pipeline` | 夹具压缩包的完整基础分析、编码转换（GB18030 / gzip）、规则命中、嫌疑评分、证据包生成；启动器配置解析与回退（PCL2 / HMCL / 路径无效 / JSON 损坏）、环境补全与不覆盖；目录分析（结构识别、崩溃报告、重复模组、跳过 assets、空目录报错）；Java 扫描（版本/架构归一、release 解析、无效项、候选去重、`JAVA_HOME`、空结果） |
| 端到端 | `npm run test:e2e` | 真实 Electron 窗口内的 IPC 往返、自动 AI 守卫输出、行号定位（打印判读，无断言） |
| 类型检查 | `npm run typecheck` | 渲染层与预加载类型（主进程类型由 `tsconfig.node.json` 覆盖，未纳入该脚本） |

夹具生成链路：`test/fixture-src`（可读 UTF-8 源）→ `node test/make-fixture.cjs` → `test/fixture-build`（`latest.log` 转 GB18030、历史日志转 `.gz`、写入同名不同版本的假 jar）→ 压缩为 `test/fixture.zip`。脚本不包含压缩步骤，需外部打包。

端到端脚本的设计意图是「守卫验证」而非「成功验证」：它故意在未开启自动分析时调用 `trigger: 'auto'`，期望得到拦截错误（若输出 `LEAKED` 则说明守卫失效），以此确认自动调用不会绕过设置。脚本还会临时构造 PCL2 目录，经 `launcher:refresh` 走一遍真实 IPC，确认默认 `disabled`、解析结果正确，且分析结果中的环境字段不被覆盖。脚本本身不含断言，只有抛出异常或超时才以非零码退出，正常路径下需人工判读输出。

## 9. 构建与分发

- `npm run build` 只产出 `out/{main,preload,renderer}`；`npm run dist` 在此基础上调用 electron-builder，产物默认写入 `dist/`。
- `electron-builder.yml` 仅收录 `out/**` 与 `package.json`，生产依赖由 electron-builder 依据 `package.json` 自动加入（`chardet`、`iconv-lite`、`yauzl` 等），并打入 `app.asar`。
- Windows x64 产出 NSIS 安装包与便携版；`artifactName` 使用包名与版本，避免中文文件名带来的工具链问题。
- 图标为 `build/icon.png`（512×512），由 `tools/make-icon.py` 以标准库生成，不引入图像依赖。
- 产物未签名；需要时通过 `CSC_LINK` / `CSC_KEY_PASSWORD` 注入证书。未配置自动更新与 CI。
- 打包后 `app.getPath('userData')` 为 `%APPDATA%\lingyu-mc-log-analyzer`；首次启动由 `migrateLegacyUserData()` 从旧目录 `mc-log-analyzer` 复制 `settings.json` 与 `java-runtimes.json`，不删除旧数据。

## 10. 已知技术债

| 问题 | 位置 | 影响 |
| --- | --- | --- |
| `useRuleEngine` 未接入 | `settings.ts` 定义、`SettingsDrawer.tsx` 展示、`base.ts` 未读取 | 开关无实际效果，规则始终执行 |
| 历史日志提示与实际行为矛盾 | `base.ts` 的 `notes.push` 条件要求「有历史候选且未加载历史」，实际几乎不可达 | 用户可能误以为历史日志未被分析，实际已纳入最多 4 份 |
| `version_json` 只登记不解析 | `discover.ts` → `versionJsons` | 无法从 `versions/*.json` 补齐模组清单，弱信号因此缺失 |
| `NOTE` 表重复维护 | `discover.ts` 与 `base.ts` 各一份 | 新增类型时两处都要改，文案容易不一致 |
| 单文件类型判定粗糙 | `base.ts` 的 `loadSingleFile` 仅按文件名包含 `crash` / `hs_err` 判断 | 重命名过的崩溃报告会被当作 `other`，缺少 `parseCrashReport` 结构化 |
| 模型输出无重试 | `index.ts` 的 `analysis:ai` | 非法 JSON 直接失败，需人工重试 |
| 无单元测试框架 | 仅管线脚本与 E2E | 规则级回归缺少细粒度断言 |
| E2E 无断言 | `tools/e2e.cjs` | 分析返回失败时仍以 0 退出，只能人工判读输出 |
| 条目上限静默截断 | `extract.ts` 的 `MAX_ENTRIES` 分支 | 超出后用户不会收到提示，可能漏读文件 |
| 无游戏启动流程 | — | 启动器配置只能补全分析环境，无法作为真正的启动参数来源 |
| HMCL 配置布局启发式 | `launcher/hmcl.ts` | 实例无法定位时跳过内存/Java；不同 HMCL 版本的字段可能变化 |
| PCL2 Java 未解析 | `launcher/pcl.ts` | 只读取游戏目录与内存，Java 选择留在启动器内 |
| 目录扫描深度固定 | `analysis/scan.ts` | 超过 3 层的日志不会被发现；非常规布局需改用导出包 |
| 注册表来源受环境限制 | `java/registry.ts` | 安全策略禁止 `reg.exe` 时只依赖目录与环境变量 |
| Java 探测可能被拦截 | `java/identify.ts` | 缺少 `release` 且 `java -version` 被拦截时，该项标记为无效 |
