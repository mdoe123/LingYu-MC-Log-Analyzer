# 灵羽的MC日志分析器（LingYu MC Log Analyzer）

> 英文名：**LingYu MC Log Analyzer**；内部包名 `lingyu-mc-log-analyzer`。
> 用户数据目录为 `%APPDATA%\lingyu-mc-log-analyzer`；首次启动会把旧目录 `mc-log-analyzer` 中的 `settings.json` 与 `java-runtimes.json` 自动复制过来（不删除旧数据）。

面向 Minecraft 整合包玩家的崩溃日志分析工具。拖入启动器导出的日志包，工具在本机完成解压、编码归一、堆栈解析与规则匹配，先给出「失败阶段 + 命中特征 + 疑似模组」；需要更深入的归因时，再把脱敏后的证据包交给大模型复核。

核心目标是把「翻两万行 `latest.log` 找根因」压缩成一次拖拽 + 一次确认。

---

## 设计原则

| 原则 | 具体实现 |
| --- | --- |
| 本地优先 | 解压、解码、解析、规则匹配全部在主进程内存中完成，基础分析不联网、不消耗 token |
| AI 显式触发 | 默认只有点击「AI 分析」才会调用模型；自动分析需在设置中显式开启 |
| 结论可溯源 | 规则与 AI 的每条结论都带 `文件:行号`，可在内置查看器中跳转到原文上下文 |
| 只发送证据 | 提交给模型的是结构化证据包（≤ 38,000 字符），不是原始日志，且默认脱敏 |

---

## 功能

- **多格式导入**：支持 HMCL / PCL2 导出的 `.zip`，以及单个 `.log` / `.txt` 文件；支持拖拽。
- **直接读取游戏目录**：选择 `.minecraft`（或版本隔离目录）即可分析 `logs`、`crash-reports`、`mods`、`versions`，无需先导出压缩包；启用启动器联动后可从其配置读出目录并一键分析。
- **五阶段基础分析**：解压 → 识别日志类型 → 编码归一 → 堆栈解析 → 规则匹配，逐阶段回传进度。
- **编码自动归一**：按 BOM → 统计探测 → UTF-8 有效性回退的顺序处理 UTF-8 / UTF-16LE / GB18030 / BIG5，中文 Windows 下的 GBK 日志不会乱码。
- **失败阶段判定**：区分「启动器拉起」「游戏 / 模组初始化」「运行期」三类失败，避免用启动期证据解释运行期问题。
- **14 条内置规则 + 2 条动态检查**：覆盖 OOM、缺类、签名不匹配、Mixin 注入失败、缺前置、加载失败、tick 崩溃、端口占用、Java 版本、图形初始化、注册表重映射、着色器、数据包，以及 `hs_err_pid`（JVM 崩溃）与重复模组。
- **嫌疑模组评分**：按信号强弱加权汇总（Mixin 点名 72 分、非原版堆栈帧 64 分、缺前置 55 分……），输出最多 8 个候选及理由。
- **AI 深度归因**：流式输出，返回严重级别、置信度、根因分段、关键证据、相关组件与有先后顺序的修复建议。
- **证据跳转**：任意证据可打开日志查看器，定位到目标行并显示该行附近的 220 行上下文。
- **报告导出**：复制到剪贴板，或导出 Markdown。
- **启动器配置联动（可选）**：指定 PCL2 / HMCL 文件后，应用启动时只读解析其配置，把游戏目录、内存与 Java 作为环境默认值；默认关闭。
- **Java 运行时扫描（只读）**：按需扫描环境变量、PATH、注册表与常见安装目录，识别版本、厂商与架构，结果缓存在本机；不参与日志分析。

---

## 快速开始

### 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`（Vite / electron-vite 的引擎要求；Electron 44 自身声明 `>=22.12.0`，建议统一使用 Node 22 LTS）
- Windows / macOS / Linux 桌面环境（端到端测试需要图形会话）

### 安装与开发

```bash
npm install
npm run dev
```

### 常用命令

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `npm run dev` | 启动 Electron 开发模式 | 主进程 / 预加载 / 渲染进程热更新 |
| `npm run build` | 构建到 `out/` | 产物为未打包的 JS / HTML / CSS |
| `npm start` | 预览构建产物 | 需先执行 `npm run build` |
| `npm run dev:web` | 浏览器预览界面 | 固定端口 `5273`，使用 mock 数据，不做真实分析 |
| `npm run typecheck` | 渲染层类型检查 | `tsc --noEmit -p tsconfig.web.json` |
| `npm run test:pipeline` | 分析管线测试 | 构建 `test/run.ts` 后以 Node 运行，打印结构化结果 |
| `npm run test:e2e` | Electron 端到端冒烟 | 自动构建后在真实窗口内调用 IPC，打印守卫与定位结果 |
| `npm run pack` | 生成未打包目录 | 输出到 `dist/win-unpacked/`，便于调试 |
| `npm run dist` | 生成 Windows 二进制 | 安装包与便携版输出到 `dist/` |

浏览器预览用于调界面：`src/renderer/src/lib/bridge.ts` 会检测 `window.api`，缺失时回退到内置 mock（含示例日志与模拟流式输出），设置存在 `localStorage` 的 `mclog.settings.v2`。

### 打包二进制（Windows）

```bash
npm run dist
```

产物位于 `dist/`：

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `lingyu-mc-log-analyzer-0.1.0-setup.exe` | NSIS 安装包 | 可选安装目录，创建桌面与开始菜单快捷方式 |
| `lingyu-mc-log-analyzer-0.1.0-portable.exe` | 便携版 | 单文件，双击运行，无需安装 |
| `win-unpacked/` | 解包目录 | 调试用，可直接运行 `灵羽的MC日志分析器.exe` |

安装后显示名、快捷方式与 exe 均为「灵羽的MC日志分析器」；安装包文件名沿用内部包名 `lingyu-mc-log-analyzer-*`，便于命令行分发与后续自动更新。

注意事项：

- 当前仅配置 Windows x64；macOS / Linux 需在对应系统上增加 target，不能从 Windows 交叉构建 macOS。
- `appId` 已由 `com.mclog.analyzer` 更新为 `com.lingyu.mclog`，与旧安装包不在同一升级链；请先卸载旧版再安装。用户数据会在首次启动时自动迁移。
- 产物**未签名**，Windows SmartScreen 可能提示“未知发布者”。有代码签名证书时设置 `CSC_LINK` 与 `CSC_KEY_PASSWORD` 后重新执行 `npm run dist`。
- 网络受限时可指定镜像：`ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR`（参考 `npmmirror.com` 对应目录）。
- 图标为 `build/icon.png`，可执行 `python tools/make-icon.py` 重新生成；打包配置见 `electron-builder.yml`。
- 用户数据仍存放在 `%APPDATA%\lingyu-mc-log-analyzer`，便携版不会改为程序所在目录。

---

## 使用流程

1. **导入**：拖入压缩包或单个日志，或点击「读取游戏目录」选择 `.minecraft`。压缩包体积上限默认 200 MB，可在设置中调整（10–4096 MB）。
2. **基础分析**：界面依次展示五个阶段的进度与明细（条目数、命中文件数、编码转换结果、解析行数、规则命中数）。
3. **查看基础结果**：失败阶段与判定依据、日志统计、运行环境、崩溃报告摘要、规则命中及证据、疑似模组、关键词统计、说明。
4. **AI 归因（可选）**：点击「开始 AI 分析」；若未配置 API Key 会直接引导到设置页。分析期间可取消。
5. **导出**：复制报告或导出 `.md` 文件。

快捷键：`Ctrl/Cmd + ,` 打开或关闭设置，`Esc` 关闭设置与日志查看器。

### 支持的输入

压缩包内按文件名分类，同类文件按数量限额纳入分析：

| 类型 | 识别规则 | 上限 | 用途 |
| --- | --- | --- | --- |
| `crash` | `crash-YYYY-MM-DD*.txt` | 6 | 崩溃报告，提取 Description / Caused by 链 / 首个非原版帧 |
| `hs_err` | `hs_err_pid<pid>.log` | 3 | JVM 崩溃日志，触发 `hs_err` 规则并把阶段判为运行期 |
| `latest` | `latest.log` | 1 | 主日志，规则匹配与阶段判定主力 |
| `fml` | `fml-client-latest.log`、`fml-server-latest.log` | 2 | 加载器日志 |
| `debug` | `debug.log`、`debug-N.log` | 1 | 调试日志，信噪比低 |
| `history` | `YYYY-MM-DD-N.log`，以及其他 `.log` | 4 | 历史日志，按文件名倒序取最近若干份 |
| `launcher` | `hmcl*.log`、`pcl*.log`、`pcl2*.log`、`launcher*.log`，或路径含 `/hmcl/logs/` | 3 | 启动器日志 |
| `version_json` | `versions/**.json` | 2 | 仅登记，不参与解析 |
| `mods/*.jar` | 路径含 `mods/` 的 jar | — | 仅取文件名，用于模组清单与重复版本检测，不读取内容 |

- `.gz` 条目先剥离后缀再分类，读取时用 `gunzipSync` 解压。
- 单个 `.log` / `.txt` 走单文件通道：仅按文件名判定 `crash` / `hs_err` / `latest` / `other`，没有 mods 清单，因此重复模组检测不生效。

#### 直接读取游戏目录

「读取游戏目录」选择 `.minecraft` 或版本隔离目录后，只扫描与诊断相关的文件：

| 位置 | 用途 |
| --- | --- |
| `logs/*.log`、`*.log.gz` | 主日志、调试日志、历史日志 |
| `crash-reports/*.txt` | 崩溃报告 |
| `mods/*.jar`（含 `versions/*/mods`） | 仅取文件名，用于模组清单与重复版本检测 |
| `versions/*/*.json` | 仅登记，不参与解析 |
| 根目录 `*.log`、`hmcl.log` 等 | 启动器日志 |

扫描最多 3 层子目录、20,000 个条目，跳过 `assets`、`libraries`、`runtime`、`saves`、`config` 等与诊断无关或体量大的目录。目录必须包含 `logs`、`crash-reports`、`versions` 之一，否则直接报错。所有路径以相对路径呈现，证据定位与压缩包模式一致；目录模式不检查压缩包体积上限，但沿用单文件 48 MB、总量 160 MB、单文件 30 万行的限制。

### 资源限额

| 限制 | 值 | 说明 |
| --- | --- | --- |
| 单文件读取 | 48 MB | 超出部分不读取；ZIP 内的截断会在结果「说明」中提示 |
| 单次分析文本总量 | 160 MB | 达到上限后剩余文件不再参与 |
| 单文件行数 | 300,000 行 | 超出时保留尾部（崩溃现场在末尾），行号按偏移还原 |
| ZIP 条目数 | 20,000 | 超出即截断条目列表 |
| 目录扫描 | 3 层 / 20,000 条目 | 只保留 `log/txt/json/jar/gz` 扩展名，跳过无关目录 |
| 证据包 | 38,000 字符 | 超出按段落截断 |
| AI 证据位置 | 4 条 | 模型只能引用材料中真实存在的位置 |

---

## 设置项

设置保存在 Electron `userData` 目录下的 `settings.json`；API Key 通过 `safeStorage` 加密后以 `apiKeyEnc` 字段存储（系统不支持加密时退化为明文 `apiKey`）。

| 分组 | 设置 | 默认值 | 说明 |
| --- | --- | --- | --- |
| AI 触发 | `autoAi` | `false` | 开启后基础分析完成即自动调用一次模型；手动触发不受影响 |
| 模型服务 | `provider` | `deepseek` | 预置 DeepSeek / OpenAI / Kimi / 智谱 GLM / 本地 Ollama / 自定义端点 |
| | `baseUrl` | `https://api.deepseek.com/v1` | OpenAI 兼容端点，请求 `<baseUrl>/chat/completions` |
| | `model` | `deepseek-chat` | 模型名 |
| | `apiKey` | 空 | Ollama 可不填，其余服务商缺失时会阻止调用 |
| 生成参数 | `temperature` | `0.2` | 界面范围 0–1 |
| | `maxTokens` | `2048` | 界面范围 256–8192 |
| | `maxEvidence` | `8` | 证据块数量，写入时钳制在 2–16，证据包内再钳制到 10 |
| | `language` | `zh` | 仅影响 AI 结论语言（简体中文 / English） |
| 分析行为 | `useRuleEngine` | `true` | 当前版本规则引擎始终启用，该开关尚未接入逻辑，详见「已知限制」 |
| | `redact` | `true` | 发送前替换 IPv4、UUID、邮箱、玩家名 |
| 文件处理 | `maxArchiveMb` | `200` | 压缩包体积上限，写入时钳制在 10–4096 |
| 启动器联动 | `launcher.enabled` | `false` | 启用后应用启动时读取一次启动器配置；关闭时不做任何文件读取 |
| | `launcher.kind` | `auto` | `auto` / `pcl` / `hmcl`；自动模式按文件名与配置文件特征判断 |
| | `launcher.exePath` | 空 | 启动器可执行文件或 jar 的绝对路径，仅读取不执行 |

「测试连接」会以 8 秒超时请求 `<baseUrl>/models`：`401/403` 报 Key 无效，`404` 提示地址缺少 `/models`，超时与网络错误分别提示。

---

## 启动器联动（可选）

目的是让应用继承 PCL2 / HMCL 中已经配好的游戏目录、最大内存与 Java 路径，免去在两处重复填写。

### 存储方式

与其他设置同存于 `userData/settings.json`，为嵌套对象：

```json
"launcher": { "enabled": false, "kind": "auto", "exePath": "" }
```

读取时统一归一化：`kind` 不是 `auto` / `pcl` / `hmcl` 时回退 `auto`，`exePath` 非字符串时置空，`enabled` 仅接受布尔真值。旧版配置文件缺少该字段时自动补默认值，不需要迁移。该配置不加密、不写注册表。

### 位置选择

- 设置 → 启动器联动 → 「选择文件」打开系统文件对话框（Windows 过滤 `exe/jar/bat/cmd`），选中后写入设置并立即解析一次，状态行显示识别结果。
- 路径框为只读，避免手输错误；类型可手动指定 PCL2 / HMCL，用于文件名无法识别的情况。
- 选择文件**不会**自动开启开关，必须显式打开「读取启动器配置」，以保证默认关闭。

### 读取时机

- **应用启动**：`app.whenReady` → 注册 IPC → 创建窗口 → 异步读取一次，不阻塞窗口显示。
- **设置保存**：`settings:save` 落盘后重新读取，改动立即生效。
- **手动刷新**：设置面板的「重新读取」。
- **分析前兜底**：设置为启用但缓存仍为 `disabled`（启动读取未完成）时，`analysis:run` 补读一次。
- 全程只读：不执行启动器、不修改其配置文件、不联网。

### 支持的字段

| 启动器 | 配置位置 | 读取字段 |
| --- | --- | --- |
| PCL2 | `<启动器目录>/PCL/Setup.ini`（`Key:Value` 平铺，非标准 INI） | `LaunchFolderSelect` → 游戏目录；`LaunchRamType` + `LaunchRamCustom` → 最大内存（GB 转 MB，仅自定义模式） |
| HMCL 3.16+ | `<启动器目录>/config/launcher-settings.json`、`config/game-directories.json`、`<实例>/.hmcl/config/instance-game-settings.json` | `selectedGameDirectory` → 目录 ID；`directories[].path` → 游戏目录；`selectedInstance` → 实例；`maxMemory`、`customJavaPath` |
| HMCL 旧版 | `<启动器目录>/hmcl.json` 或 `.hmcl.json` | `gameDir`、`javaDir` 等旧字段 |

### 失败处理

| 情况 | 行为 |
| --- | --- |
| 功能关闭 | 返回 `disabled`，不做任何文件读取 |
| 未选择文件 | 返回 `unconfigured`，提示选择，分析仅使用日志自身信息 |
| 路径不存在或不是文件 | 返回 `error` 并说明原因，按默认设置继续 |
| 无法识别启动器类型 | 返回 `error`，提示手动指定类型 |
| 配置文件缺失 | 返回 `error`（如「未找到 PCL2 配置文件 PCL/Setup.ini」） |
| 配置损坏 / JSON 非法 | 捕获解析异常并返回 `error`，不上抛 |
| 仅部分字段可读 | 返回 `ok` + `warnings`，可读字段生效，其余留空 |

所有失败都不会抛出到启动流程，也不会阻塞应用启动。

### 应用方式与边界

- 只补全 `BaseAnalysis.environment` 中日志未提供的 `launcher` 与 `maxMemoryMb`；日志已有值不覆盖，并在结果「说明」中标注来源。
- 当前版本没有游戏启动流程，因此该配置**不会用于启动游戏**，也不改变原有分析、AI 与文件处理行为。
- 不解析 PCL2 的 Java 选择（其值为结构化字符串，版本间差异大）；HMCL 的 Java 路径在选中实例可定位时读取。

---

## Java 运行时扫描（只读）

用于回答「本机有哪些 Java、分别是哪个版本」，不参与日志分析与游戏启动。

### 扫描来源

| 来源 | 内容 | 说明 |
| --- | --- | --- |
| 环境变量 | `JAVA_HOME`、`JDK_HOME`、`JRE_HOME` | 直接作为候选 |
| PATH | 含 `java.exe` / `java` 的目录 | 解析符号链接后回溯到 Java Home，兼容 Store 别名与包管理器 shim |
| 启动器 | 当前解析出的 `javaPath` | 单条，来自 HMCL 实例配置 |
| Windows 注册表 | `JavaSoft`、`Eclipse Adoptium`、`Microsoft`、`Zulu`、`BellSoft`、`Corretto`、`SapMachine` | 通过 `reg.exe` 查询；失败或受限时静默跳过 |
| 标准安装目录 | Windows `Program Files` 下各厂商目录；macOS `/Library/Java/JavaVirtualMachines`；Linux `/usr/lib/jvm` 等 | 只列一到两层，不递归整盘 |
| 游戏运行时 | `<gameDir>/runtime` | 向下探测两层，覆盖官方启动器与部分整合包自带的 JRE |

### 识别方式

1. 优先读取 `<javaHome>/release` 的 `JAVA_VERSION`、`IMPLEMENTOR`、`OS_ARCH`，不执行二进制。
2. `release` 缺失版本信息时，才以 2.5 秒超时执行 `java -XshowSettings:properties -version`，解析 `java.version`、`java.vendor`、`sun.arch.data.model`。
3. 版本归一：`1.8.0_392` → 主版本 8，`17.0.8` → 17；架构归一为 `x86` / `x64` / `aarch64`。
4. 按 `realpath` 去重（避免符号链接/目录联接重复），有效项按主版本倒序排列。
5. 缺少 `bin/java` 或无法识别版本的目录会保留为「无效」，并附上原因，便于排查。

### 触发与缓存

- **不会自动扫描**：应用启动时只读取上次缓存；只有点击设置页「扫描本机 Java」才执行。
- 结果写入 `userData/java-runtimes.json`，下次打开设置直接展示。
- 单次扫描上限：8 秒、120 个候选、并发 4；超时会把未完成项写入 `warnings`，不阻塞界面。

### 边界

- 绿色版、重命名过的 JDK、安装在非常规目录的 JDK 无法保证被发现。
- 注册表读取依赖系统 `reg.exe`；安全策略禁止时该来源被跳过，其余来源仍可用。
- 仅有 `javaw.exe` 也能识别；Store 的 0 字节别名会通过 `realpath` 解析，解析失败则跳过。
- 某些安全软件会拦截 `java -version` 探测；此时只读取 `release`，缺失则标记为无效。
- 结果只是「尽力枚举」，不代表系统中 Java 的完整清单；导入项目时请以实际选择为准。
- 当前不用于启动游戏，也不参与日志分析；仅作为环境信息展示与后续功能的候选来源。

---

## 隐私与安全

- **发送内容**：仅证据包，包含运行环境、本地规则判定、关键词统计、规则命中位置、嫌疑对象、崩溃报告头部、至多 10 个异常块、模组清单（前 120 个）。不含完整日志。
- **脱敏规则**：IPv4 → `<ip>`，UUID → `<uuid>`，邮箱 → `<email>`，`Setting user:` 后的玩家名 → `<player>`。
- **密钥存储**：`safeStorage` 加密（Windows DPAPI / macOS Keychain / Linux 依 secret service 可用性），不写入日志，不回传。
- **进程隔离**：`contextIsolation: true`、`nodeIntegration: false`；渲染进程只能通过 `window.api` 调用白名单 IPC。
- **外链限制**：仅 `http/https` 链接交给系统浏览器；窗口内导航除开发地址与本地页面外一律阻止。
- **压缩包处理**：拒绝绝对路径与含 `..` 的条目，不落盘解压，仅在内存中按需读取条目内容；外部链接一律交给系统浏览器。
- **启动器配置只读**：仅在启用联动后读取用户选定的启动器配置文件，不执行启动器、不写回配置、不联网。
- **Java 扫描只读**：只读取 `release` 文件与目录信息；仅在缺少版本信息时执行 `java -XshowSettings:properties -version`（2.5 秒超时），不写回任何 JDK。
- **无遥测**：除用户主动配置的模型服务外，不发起任何网络请求。

---

## 目录结构

```
LingYvMinecraftAITool/
├─ src/
│  ├─ main/                    Electron 主进程
│  │  ├─ index.ts              窗口创建、IPC 注册、生命周期
│  │  ├─ settings.ts           设置读写、钳制与 API Key 加密
│  │  └─ analysis/
│  │     ├─ base.ts            管线编排：解压 → 识别 → 解码 → 解析 → 规则
│  │     ├─ extract.ts         yauzl 列条目 / 读流，含路径安全检查
│  │     ├─ scan.ts            游戏目录遍历与限长读取
│  │     ├─ discover.ts        文件分类、数量限额、mods 清单收集
│  │     ├─ decode.ts          BOM / chardet 编码探测与换行归一
│  │     ├─ parse.ts           行前缀解析、堆栈块合并、行号偏移
│  │     ├─ crash.ts           崩溃报告结构化提取
│  │     ├─ rules.ts           规则库、阶段判定、环境提取、嫌疑评分
│  │     └─ ai.ts              证据包、提示词、流式调用、JSON 归一
│  ├─ launcher/               启动器配置解析（PCL2 / HMCL，只读）
│  │  ├─ index.ts              路径校验、类型识别、解析编排、环境补全
│  │  ├─ pcl.ts                PCL2 Setup.ini（Key:Value 平铺）
│  │  └─ hmcl.ts               HMCL 全局配置、目录映射、实例级设置
│  ├─ java/                   本机 Java 运行时扫描（只读）
│  │  ├─ scan.ts               候选收集、并发识别、去重与时间预算
│  │  ├─ identify.ts           release 解析、版本/架构归一、超时探测
│  │  └─ registry.ts           Windows 注册表查询
│  ├─ preload/index.ts         contextBridge 暴露 window.api
│  ├─ renderer/                React 19 界面
│  │  └─ src/
│  │     ├─ App.tsx            阶段状态机、拖拽、报告导出
│  │     ├─ components/        结果视图、进度视图、设置抽屉、日志查看器
│  │     ├─ lib/bridge.ts      桌面 / 浏览器双通道适配
│  │     └─ data/mock.ts       Provider 预设、示例数据、阶段定义
│  └─ shared/types.ts          跨进程共享类型与 IPC 契约
├─ build/icon.png              应用图标（由 tools/make-icon.py 生成）
├─ electron-builder.yml        Windows 打包配置
├─ test/
│  ├─ fixture-src/             夹具源文件（crash / latest / debug / hmcl / history）
│  ├─ make-fixture.cjs         生成 fixture-build（GB18030 编码、gzip 历史日志、重复 jar）
│  ├─ fixture.zip              压缩后的测试包
│  └─ run.ts                   管线测试入口
├─ tools/
│  ├─ e2e.cjs                  Electron 端到端冒烟测试
│  └─ make-icon.py             生成 512×512 应用图标
├─ out/                        构建产物（gitignore）
├─ dist/                       安装包与便携版（gitignore）
└─ qwq/                        本地参考资料：HMCL / PCL2 源码与发行包（gitignore，不参与构建）
```

---

## 测试

### 分析管线测试

```bash
npm run test:pipeline
```

`test/run.ts` 会对 `test/fixture.zip` 执行完整基础分析并打印：各阶段进度、文件清单与编码、环境、阶段判定、崩溃报告、规则命中、嫌疑评分、关键词统计、说明，以及证据包前 2,200 字符。

末尾还会运行启动器配置检查：关闭时不读取、路径无效与 JSON 损坏时回退、PCL2 与 HMCL 的字段解析、环境补全且不覆盖已有值；随后在临时目录上验证「直接读取游戏目录」：结构识别、崩溃报告解析、重复模组与 Mixin 命中、跳过 assets、空目录报错；最后验证 Java 扫描：版本与架构归一、release 解析、缺失可执行文件标记无效、候选去重、`JAVA_HOME` 采纳、空结果提示。任一检查失败即以非零码退出。

夹具覆盖：GB18030 编码的 `latest.log`、gzip 压缩的历史日志、`hmcl.log`、崩溃报告，以及 `mods/` 下同名不同版本的 jar（用于验证重复模组规则）。

修改 `test/fixture-src/` 后，执行 `node test/make-fixture.cjs` 生成 `test/fixture-build/`（该脚本不包含压缩步骤），再将其打包为 `test/fixture.zip`。

### 端到端冒烟

```bash
npm run test:e2e
```

启动真实 Electron 窗口，注入脚本依次调用 `analysis.run` → `analysis.ai({ trigger: 'auto' })` → `analysis.lines`，输出：分析是否成功、文件数、阶段、加载器、规则命中、嫌疑排序、自动 AI 守卫的返回内容（若返回 `LEAKED` 说明守卫失效）、行号定位结果。脚本还会临时构造一个 PCL2 目录，验证启动器联动：默认 `disabled`、刷新后 `ok` 且游戏目录与内存解析正确、分析环境不被覆盖；并在同一目录写入 `logs` 与 `crash-reports`，调用目录分析验证真实 IPC 返回 `dirOk / dirFiles / dirStage`。脚本以是否抛出异常决定退出码，30 秒未完成则以 2 退出，结果需人工判读。

---

## 已知限制

1. **`useRuleEngine` 开关未接线**：`rules.ts` 的规则始终执行，该设置目前只影响界面展示。
2. **历史日志说明与实际行为不一致**：侧栏与说明文案暗示历史日志默认不参与，实际 `discover` 会纳入最多 4 份；`base.ts` 中对应的提示分支几乎不会触发。
3. **仅支持 ZIP**：`.7z`、`.rar`、`.tar.gz` 不支持；单文件模式仅接受 `.log` / `.txt`。
4. **无重试与缓存**：模型返回非法 JSON 时直接报错，需要重新点击；重启应用后需重新导入文件（上次分析上下文只保存在主进程内存）。
5. **无代码签名与自动更新**：已提供 `electron-builder` 打包配置（Windows x64），但产物未签名、未接入自动更新与 CI 发布流程。
6. **界面仅中文**：`language` 设置只切换 AI 结论语言。
7. **规则存在误报面**：如 `gl` 规则包含裸 `OpenGL` 关键词，会命中正常初始化行；关键词统计按「包含该字符串的行数」计数，堆栈帧也会计入，不等于错误条数。
8. **没有游戏启动流程**：启动器联动只补全分析环境，不参与启动游戏，也不执行启动器本身。
9. **HMCL 配置读取依赖版本布局**：3.16+ 的 `config/*.json` 与旧版 `hmcl.json` 字段不同；实例无法定位时只跳过实例级内存/Java，不影响其余字段。
10. **不解析 PCL2 的 Java 选择**：`LaunchArgumentJavaSelect` 为结构化字符串，当前只读取游戏目录与内存。
11. **目录模式依赖标准布局**：只扫描 3 层子目录并跳过 `config` 等目录；日志放在非常规位置的整合包请改用导出压缩包。
12. **Java 扫描是尽力枚举**：便携版、重命名或安装在非常规目录的 JDK 不会被发现，不能当作系统全量清单。
13. **注册表来源可能不可用**：受限环境中 `reg.exe` 被禁止时会跳过该来源，仅依赖环境变量与目录扫描。
14. **Java 扫描不自动执行**：启动时只读缓存；缓存为空时设置页显示「尚未扫描」。
15. **仅提供 Windows x64 二进制**：`npm run dist` 生成安装包与便携版；macOS / Linux 需要单独配置 target 并在对应系统构建。

---

## 延伸阅读

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：进程模型、IPC 契约、分析管线实现、评分模型、提示词设计与扩展点。
- [docs/RULES.md](docs/RULES.md)：全部规则的特征签名、归因要点、证据采集方式与新增规则流程。
- [docs/VERSION_ISOLATION.md](docs/VERSION_ISOLATION.md)：版本隔离与共享目录的工作原理、目录树、HMCL / PCL2 实现差异及切换注意事项。
- [docs/AUDIT.md](docs/AUDIT.md)：项目审查报告——命名、结构、代码质量、构建与依赖问题清单及改进建议。
- 解决方案示例：[玩家版](docs/SOLUTION_PLAYER.md) / [专业版](docs/SOLUTION_EXPERT.md)：Oculus × Embeddium 注入冲突的双受众写法。

## 许可

GPL-3.0（见 `LICENSE`）。
