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

## 2. 静态规则（14 条）

| ID | 级别 | 触发签名 | 归因要点 | 首要动作 |
| --- | --- | --- | --- | --- |
| `oom` | critical | `OutOfMemoryError` | 堆内存耗尽。整合包模组多、渲染距离过高或模组内存泄漏；与模组兼容性无关 | 最大内存提到当前值 1.5–2 倍（大型包 6–8 GB），并确认使用 64 位 Java |
| `classdef` | high | `NoClassDefFoundError`、`ClassNotFoundException` | 运行期缺类。多为前置缺失或版本不匹配，也可能是 jar 损坏、Java 版本过低 | 按堆栈包名反查并安装对应前置 |
| `nosuchmethod` | high | `NoSuchMethodError`、`NoSuchFieldError` | 编译期成员在运行期找不到签名，几乎总是版本错配（模组↔本体，或模组↔模组） | 把相关模组对齐到同一发布周期 |
| `mixin` | critical | `Mixin apply failed`、`InvalidInjectionException`、`Mixin transformation of` | 注入点被其它模组改写，签名或结构不匹配，渲染/初始化流程中止 | 更新或回退最近变动的冲突模组；同类优化模组只留一个 |
| `missing-dep` | high | `Missing or unsupported mandatory dependencies`、`which is missing`、`requires ... of/from mod` | 加载器解析依赖时发现前置缺失或版本越界，发生在加载早期 | 安装日志点名的 modid，版本与游戏、加载器一致 |
| `modload` | critical | `Failed to load mod`、`ModLoadingException`、`ModResolutionException`、`LoadingFailedException` | 构建模组容器时抛错，尚未进入渲染阶段；真实原因在异常链末尾 | 读紧随其后的最后一条 `Caused by`；核对模组与游戏版本、加载器类型 |
| `tick` | high | `Ticking entity`、`Ticking block entity`、`Ticking screen` | 世界已加载，实体或方块实体在 tick 时抛异常，属运行期问题 | 按坐标用 NBTExplorer 删除问题实体，或回退存档备份 |
| `servertick` | critical | `Exception in server tick loop` | 服务端主循环未捕获异常，世界被强制关闭 | 向上找同一时刻第一条 ERROR，而非 tick 异常本身 |
| `port` | medium | `Failed to bind to port`、`Address already in use` | 端口被其它进程占用，或上次服务端未完全退出 | `netstat -ano \| findstr :25565` 结束进程，或改 `server-port` |
| `javaversion` | high | `UnsupportedClassVersionError`、`class file version N` | 模组或本体用更高版本 Java 编译，当前环境无法加载字节码 | 1.20.5+ 用 Java 21，1.17–1.20.4 用 Java 17 |
| `gl` | medium | `GLFW error`、`Failed to create window`、`Pixel format not accelerated`、`Failed to initialize GLFW`、`OpenGL` | 窗口或 OpenGL 上下文创建失败，多与显卡驱动、核显/独显切换、远程桌面有关 | 从厂商官网更新显卡驱动；把 Java 进程设为高性能显卡 |
| `registry` | high | `Registry remapping failed`、`Missing registry entries`、`Unknown registry` | 存档引用了当前环境不存在的注册项，通常源于中途增删模组 | 恢复创建存档时的模组集合，再用新存档验证是否与存档绑定 |
| `shader` | medium | `Failed to compile shader`、`shader compilation failed`、`Could not compile program` | 光影包或渲染模组的 GLSL 程序编译失败 | 先关闭光影确认可启动，再换用与渲染模组匹配的版本 |
| `datapack` | low | `Failed to load datapack`、`Couldn't load ... as it is not a valid` | 数据包格式不合法或引用未安装模组的命名空间，通常只影响配方与进度 | 移除最近加入的 `datapacks` 条目 |

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
| Mixin 注入失败直接点名 | 72 | `Mixin apply for mod ([\w-]+) failed` |
| 崩溃堆栈首个非原版帧命中 mods 清单 | 64 | 帧的全限定名首段与 jar 解析名互相包含即视为同一模组 |
| 日志声明缺少前置 | 55 | 在含 `missing` / `requires` / `依赖` 的行中提取名称，过滤 `mod`、`modid`、`the`、`this`、`that`、`version` |
| 同名模组多版本 | 50 | jar 名解析后按名称分组，组内多于一个即触发 |
| 首个非原版帧未匹配到 jar | 46 | 取包名前两段，类型记为 `unknown`，用于提示「问题不在已列出的模组里」 |
| 崩溃前最后加载的模组 | 12 | `Found mod file <name>.jar` 的最后一条；弱信号，仅作排序参考 |

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
  ]
}
```

约束：

1. `pattern` 不带 `g` 标志，否则跨行复用会因 `lastIndex` 残留而漏匹配；
2. `id` 唯一，且不要占用 `hs_err`、`duplicate-mods`；
3. `fixes` 建议至少包含一条 `immediate`，并按「先做、再试、最后排查」排列（这是编写约定，代码不做校验）；
4. 说明文字避免出现具体模组名——规则是通用特征，点名应由嫌疑评分完成；
5. 修改后在夹具上回归，确认命中集合符合预期。

## 8. 回归基线

`npm run test:pipeline` 使用 `test/fixture.zip`，当前基线为 4 条命中：

| 规则 | 级别 | 触发 / 证据来源 |
| --- | --- | --- |
| `mixin` | critical | 崩溃报告与 `latest.log` 的 Mixin 失败现场 |
| `duplicate-mods` | high | `mods/` 下 `embeddium-0.3.25.jar` 与 `embeddium-0.3.31.jar` |
| `classdef` | high | gzip 历史日志中的 `ClassNotFoundException` |
| `nosuchmethod` | high | 崩溃报告与 `latest.log` 的 `NoSuchMethodError` |

嫌疑排序应为 `oculus`（72）→ `embeddium`（50，重复版本）→ `geckolib`（12，弱信号）；环境识别为 Forge 47.3.0 / MC 1.20.1 / Java 17.0.8 / HMCL / 47 个模组；阶段判定为初始化阶段（high）。若任一项偏离，需检查规则、解析逻辑或夹具是否发生了变更。
