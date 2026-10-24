# 规则参考

规则引擎是本地分析的核心，位于 `src/main/analysis/rules.ts`。它把解析后的日志行映射为三类输出：

- `RuleHit[]`：命中的故障特征，含级别、说明、证据位置与分级修复建议；
- `Suspect[]`：按信号强度加权的嫌疑模组；
- `SignatureCount[]`：关键词出现次数与首次位置。

规则不依赖网络，也不依赖模型，因此结果可复现、可审计。

## 1. 触发与证据采集

**候选行**：满足任一条件即进入扫描集合——级别为 `ERROR` / `FATAL` / `WARN`，或正文包含 `Exception`、`Error`、`Caused by`、`Mixin`、`Missing`、`Duplicate`、`OutOfMemory`。

**证据上限**：每条规则最多 3 条证据。同一文件内，若新锚点与已有证据的行号相差小于 3 行，视为同一现场并跳过。

**证据正文**：

- 若命中行属于某个堆栈块且块内多于一行，取整块前 14 行，行号取块起始行；
- 否则取命中行前 2 行到后 6 行的窗口，行号取窗口起始行。

**排序**：全部命中按 `critical → high → medium → low` 排序；`hs_err` 与 `duplicate-mods` 两条动态检查在排序前插入列表头部。

**加载器门槛**：部分规则只在特定加载器下生效（`RuleDef.loaders`）。识别到加载器后，未列入该家族的规则直接跳过；识别不出加载器（`unknown`）时**不启用门槛**，全部规则照常匹配，避免因识别失败而整类规则静默失效。识别逻辑见 `src/main/analysis/loader.ts`，判定依据与四个加载器的日志差异记录在 [ARCHITECTURE.md](ARCHITECTURE.md) 第 5.12 节。

## 2. 静态规则（18 条）

「加载器」列标为「全部」的规则不设门槛；其余仅在对应加载器下参与匹配。

| ID | 级别 | 加载器 | 触发签名 | 归因要点 | 首要动作 |
| --- | --- | --- | --- | --- | --- |
| `oom` | critical | 全部 | `OutOfMemoryError` | 堆内存耗尽。整合包模组多、渲染距离过高或模组内存泄漏；与模组兼容性无关 | 最大内存提到当前值 1.5–2 倍（大型包 6–8 GB），并确认使用 64 位 Java |
| `classdef` | high | 全部 | `NoClassDefFoundError`、`ClassNotFoundException` | 运行期缺类。多为前置缺失或版本不匹配，也可能是 jar 损坏、Java 版本过低 | 按堆栈包名反查并安装对应前置 |
| `nosuchmethod` | high | 全部 | `NoSuchMethodError`、`NoSuchFieldError` | 编译期成员在运行期找不到签名，几乎总是版本错配（模组↔本体，或模组↔模组） | 把相关模组对齐到同一发布周期 |
| `mixin` | critical | 全部 | `Mixin apply failed`、`InvalidInjectionException`、`Mixin transformation of` | 注入点被其它模组改写，签名或结构不匹配，渲染/初始化流程中止 | 更新或回退最近变动的冲突模组；同类优化模组只留一个 |
| `missing-dep` | high | 全部 | Forge/NeoForge `Missing or unsupported mandatory dependencies`、Fabric `which is missing` / `requires … of mod`、Quilt `Dependency for mod '<id>' on …` | 加载器解析依赖时发现前置缺失或版本越界，发生在加载早期 | 安装日志点名的 modid，版本与游戏、加载器一致 |
| `modload` | critical | 全部 | `Failed to load mod`、`ModLoadingException`、`ModResolutionException`、`LoadingFailedException` | 构建模组容器时抛错，尚未进入渲染阶段；真实原因在异常链末尾 | 读紧随其后的最后一条 `Caused by`；核对模组与游戏版本、加载器类型 |
| `tick` | high | 全部 | `Ticking entity`、`Ticking block entity`、`Ticking screen` | 世界已加载，实体或方块实体在 tick 时抛异常，属运行期问题 | 按坐标用 NBTExplorer 删除问题实体，或回退存档备份 |
| `servertick` | critical | 全部 | `Exception in server tick loop` | 服务端主循环未捕获异常，世界被强制关闭 | 向上找同一时刻第一条 ERROR，而非 tick 异常本身 |
| `port` | medium | 全部 | `Failed to bind to port`、`Address already in use` | 端口被其它进程占用，或上次服务端未完全退出 | `netstat -ano \| findstr :25565` 结束进程，或改 `server-port` |
| `javaversion` | high | 全部 | `UnsupportedClassVersionError`、`class file version N` | 模组或本体用更高版本 Java 编译，当前环境无法加载字节码 | 1.20.5+ 用 Java 21，1.17–1.20.4 用 Java 17 |
| `gl` | medium | 全部 | `GLFW error`、`Failed to create window`、`Pixel format not accelerated`、`Failed to initialize GLFW`、`OpenGL` | 窗口或 OpenGL 上下文创建失败，多与显卡驱动、核显/独显切换、远程桌面有关 | 从厂商官网更新显卡驱动；把 Java 进程设为高性能显卡 |
| `registry` | high | 全部 | `Registry remapping failed`、`Missing registry entries`、`Unknown registry` | 存档引用了当前环境不存在的注册项，通常源于中途增删模组 | 恢复创建存档时的模组集合，再用新存档验证是否与存档绑定 |
| `shader` | medium | 全部 | `Failed to compile shader`、`shader compilation failed`、`Could not compile program` | 光影包或渲染模组的 GLSL 程序编译失败 | 先关闭光影确认可启动，再换用与渲染模组匹配的版本 |
| `datapack` | low | 全部 | `Failed to load datapack`、`Couldn't load ... as it is not a valid` | 数据包格式不合法或引用未安装模组的命名空间，通常只影响配方与进度 | 移除最近加入的 `datapacks` 条目 |
| `fabric-quilt-incompatible` | critical | Fabric、Quilt | `Incompatible mods found!`、`Incompatible mod set!`、`Some of your mods are incompatible` | 加载器在游戏主类启动前完成依赖解析，失败即中止且**不生成 crash-report**，`latest.log` 是唯一证据；`A potential solution has been determined` 之后是加载器自己给出的建议 | 逐条补齐 `requires` 行点名的模组；确认没有混入其它加载器的 jar |
| `forge-neoforge-mod-loading` | critical | Forge、NeoForge | `Mod loading error has occurred`、`Mod loading failures have occurred`、`An exception was thrown, the game will display an error screen and halt`、`net.neoforged.fml.ModLoadingException`、`FatalStartupException` | 加载器在构建模组容器时中止启动，窗口不会出现；这条只是总括说明，真正原因在 `Caused by` 链末端 | 从最后一条 `Caused by` 读起；核对模组的加载器归属；查看 Mod List 的 `ERRORED` 标记 |
| `loader-wrong-build` | high | Forge、NeoForge | `is not a valid mod file`、`is for Minecraft Forge or an older version of NeoForge`、`Failed to create mod instance` | 模组元数据读取或构造函数执行失败；前两句几乎等价于「把 Forge 的 jar 放进了 NeoForge」 | 换成与加载器一致的构建（`mods.toml` vs `neoforge.mods.toml`） |
| `fabric-entrypoint` | critical | Fabric、Quilt | `Could not execute entrypoint stage`、`EntrypointNotFoundException`、`Failed to execute entrypoint` | 模组入口点（通常是 `onInitialize`）抛异常；`provided by '<mod>'` 就是出错的模组，但根因常在 `Caused by` 链里 | 读取 `provided by` 后的模组名，先补前置，再考虑更新或回退 |

## 3. 动态检查（2 条）

这两条不由关键词触发，而是由文件构成决定，因此证据可能为空：

| ID | 级别 | 触发条件 | 说明 |
| --- | --- | --- | --- |
| `hs_err` | critical | 压缩包内存在 `hs_err_pid*.log` | JVM 自身崩溃，不是 Minecraft 抛异常。排查方向为显卡驱动、原生库、Java 版本与位数。建议先看文件头部的 `Problematic frame`，它常直接指向出问题的原生库（如 `nvoglv64.dll`） |
| `duplicate-mods` | high | `mods/` 下同一模组存在多个版本 | 加载器只会随机选中其一，行为不可预测。必须先删除旧版本，保留与游戏版本匹配的最新版 |

## 4. 嫌疑评分模型

评分表达「可疑程度」，不是概率，也不代表因果已确认。同名模组（小写比较）的信号会合并：取最高分、拼接不同理由、保留首个非空版本号，最后按分数倒序取前 8 个。

| 信号 | 分值 | 提取方式 |
| --- | --- | --- |
| 崩溃报告点名（加载器自身判定） | 76 | Forge `Suspected Mods:` 区块、NeoForge `-- Mod loading issue for: <id> --`、Forge Mod List 中标记 `ERRORED` 的项 |
| Mixin 注入失败直接点名 | 72 | `Mixin apply for mod ([\w-]+) failed` |
| 加载器声明该模组加载失败 | 68 | Fabric `provided by '<mod>'`、Quilt `Dependency for mod '<mod>' on …` |
| 崩溃堆栈首个非原版帧命中 mods 清单 | 64 | 帧的全限定名首段与 jar 解析名互相包含即视为同一模组 |
| 日志声明缺少前置 | 55 | 在含 `missing` / `requires` / `依赖` / `dependency` 的行中提取名称，过滤 `mod`、`modid`、`the`、`this`、`that`、`version`；Quilt 的 `on` 之后才是缺失项，`Dependency for mod 'X'` 中的 X 只记 30 分（受害方） |
| 同名模组多版本 | 50 | jar 名解析后按名称分组，组内多于一个即触发 |
| 首个非原版帧未匹配到 jar | 46 | 取包名前两段，类型记为 `unknown`，用于提示「问题不在已列出的模组里」 |
| 崩溃前最后加载的模组 | 12 | `Found mod file <name>.jar` 的最后一条；弱信号，仅作排序参考 |

崩溃报告中的模组清单（Fabric / Quilt 的 `Fabric Mods:`，格式 `\t\t<modid>: <名称> <版本>`）用作**名称与版本回填**：命中的 modid 会补上真实版本号，并回退 `Mod Count`（报告未写 `Mod Count:` 时以清单长度计）。

界面在分数 ≥ 60 时使用高警示配色，其余使用中等级别配色；正文明确提示「分数仅表示可疑程度，不等同于确定结论」。

**jar 名解析**：去掉 `.jar` 后，找到第一个以数字开头的段作为版本起点，其前为名称；名称再去掉 `-forge` / `-fabric` / `-neoforge` / `-quilt` / `-common` 后缀。无法识别版本时整段作为小写名称。

## 5. 关键词统计

固定统计 11 个签名：`Exception`、`OutOfMemoryError`、`NoClassDefFoundError`、`ClassNotFoundException`、`NoSuchMethodError`、`Mixin apply failed`、`Failed to load mod`、`Ticking entity`、`Exception in server tick loop`、`Couldn't find resource`、`Missing or unsupported mandatory dependencies`。

只输出出现次数大于 0 的项，并记录首次出现的文件与行号，供界面一键跳转。

注意：统计口径是「包含该字符串的行数」，堆栈帧、被引用的日志文本都会计入，因此该数字不等于错误条数，只用于判断问题密度。

## 6. 误报面与调优建议

| 规则 | 风险 | 建议 |
| --- | --- | --- |
| `gl` | 包含裸 `OpenGL`，正常初始化行（如版本声明、能力查询）也会命中 | 若误报明显，把 `OpenGL` 从 pattern 中移除，仅保留 `GLFW error`、`Pixel format not accelerated` 等强签名 |
| `missing-dep` | `which is missing` 可能出现在模组自定义文案或资源警告中 | 结合证据行是否包含 `modid` / `requires` 复核，必要时收紧为 `Missing or unsupported mandatory dependencies` |
| `datapack` | `Couldn't load ... as it is not a valid` 同样用于资源包 | 视为低优先级提示，不据此下结论 |
| `mixin` + `nosuchmethod` | 同一次 Mixin 失败常同时命中两条，现场重复 | 属预期行为：一条描述机制，一条描述签名错配，阅读时以 `mixin` 为主 |
| `classdef` | 历史日志中的旧错误会被一并统计 | 结论以 `latest` / `crash` 的证据为准，历史日志仅作参考 |
| `loader-wrong-build` | `Failed to create mod instance` 在任何加载器下都可能来自无关的偶发异常 | 若证据行未同时出现 `is not a valid mod file` 一类判词，按「模组构造函数出错」理解，不要直接判定为加载器混装 |
| `fabric-quilt-incompatible` | `Some of your mods are incompatible` 也可能出现在模组自定义提示中 | 证据块首行应为 `Incompatible mods found!` 或 `Incompatible mod set!`，其余视为弱信号 |
| 加载器门槛 | 加载器识别依赖日志中的版本行；若输入只剩被截断的片段，可能判为 `unknown` 并使全部规则放开 | `unknown` 时基础分析会写入一条说明；此时对跨加载器规则（Fabric 与 Forge 各一条）保留判断 |
| 全部规则 | 单文件超过 300,000 行时只保留尾部，早期根因可能被丢弃 | 需要完整上下文时拆分日志或先裁剪无关段落 |

## 7. 新增或修改规则

在 `RULES` 数组追加定义即可被自动执行、排序与展示：

```ts
{
  id: 'unique-id',
  severity: 'high',
  pattern: /signature/i,
  title: '结论标题（不超过 20 字）',
  detail: '机制解释与常见成因。',
  fixes: [
    { level: 'immediate', title: '立刻可做的动作', detail: '具体到菜单项、文件名、启动参数。' },
    { level: 'try', title: '备选方案', detail: '…' },
    { level: 'diagnose', title: '进一步排查', detail: '…' }
  ],
  // 可选：只在对应加载器下生效。缺省表示全部加载器
  loaders: ['fabric', 'quilt']
}
```

约束：

1. `pattern` 不带 `g` 标志，否则跨行复用会因 `lastIndex` 残留而漏匹配；
2. `id` 唯一，且不要占用 `hs_err`、`duplicate-mods`；
3. `fixes` 建议至少包含一条 `immediate`，并按「先做、再试、最后排查」排列（这是编写约定，代码不做校验）；
4. 说明文字避免出现具体模组名——规则是通用特征，点名应由嫌疑评分完成；
5. 引用加载器原文措辞时以文档或源码为准，不要凭印象改写（例如 Fabric 是 `Incompatible mods found!`，Quilt 是 `Incompatible mod set!`，两者只差一个词）；
6. 声明了 `loaders` 的规则，要在 `test/run.ts` 的 `runLoaderChecks()` 里补一条「命中」与一条「跨加载器不命中」的断言；
7. 修改后在夹具上回归，确认命中集合符合预期。

## 8. 回归基线

`npm run test:pipeline` 共 98 项检查，其中夹具基线为 4 条命中（夹具是 Forge 场景，Fabric / Quilt / NeoForge 的规则由 `runLoaderChecks()` 用内联样例覆盖）：

| 规则 | 级别 | 触发 / 证据来源 |
| --- | --- | --- |
| `mixin` | critical | 崩溃报告与 `latest.log` 的 Mixin 失败现场 |
| `duplicate-mods` | high | `mods/` 下 `embeddium-0.3.25.jar` 与 `embeddium-0.3.31.jar` |
| `classdef` | high | gzip 历史日志中的 `ClassNotFoundException` |
| `nosuchmethod` | high | 崩溃报告与 `latest.log` 的 `NoSuchMethodError` |

嫌疑排序应为 `oculus`（72）→ `embeddium`（50，重复版本）→ `geckolib`（12，弱信号）；环境识别为 Forge 47.3.0 / MC 1.20.1 / Java 17.0.8 / HMCL / 47 个模组；阶段判定为初始化阶段（high）。若任一项偏离，需检查规则、解析逻辑或夹具是否发生了变更。
