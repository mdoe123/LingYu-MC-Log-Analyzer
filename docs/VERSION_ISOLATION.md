# 版本隔离与共享目录

## 结论

Minecraft 本身没有“版本隔离模式”。游戏只接受启动器传入的 `--gameDir`，并把 `mods`、`config`、`saves`、`logs`、`options.txt` 等所有相对路径解析到该目录。

所谓两种存放方式，差别只在于启动器把 `--gameDir` 指向哪里：

| 模式 | `--gameDir` | 结果 |
| --- | --- | --- |
| 非版本隔离（共享） | `.minecraft` 根目录 | 所有版本共用一套模组、配置、存档与日志 |
| 版本隔离 | `.minecraft/versions/<版本ID>` | 每个版本拥有独立的运行目录 |

`assets/`、`libraries/`、`runtime/` 以及 `versions/<id>/<id>.jar|json` 始终是共享或版本自带的资源，不受隔离影响。

## 工作原理

启动器最终拼出的命令类似：

```text
java -cp <libraries + 版本 jar> net.minecraft.client.main.Main \
  --gameDir <运行目录> \
  --assetsDir <assets 目录> \
  --assetIndex <资源索引> \
  --version <版本ID> \
  --uuid ... --accessToken ...
```

- `--gameDir` 决定游戏的“工作目录”。游戏用相对路径访问 `mods/`、`config/`、`saves/`、`logs/`、`crash-reports/`、`resourcepacks/`、`shaderpacks/`、`options.txt`、`servers.dat`。
- 版本清单 `versions/<id>/<id>.json` 与 `libraries/`、`assets/` 由启动器解析，用来构建类路径和资源索引，与 `--gameDir` 无关。
- 因此“隔离”不是复制一份游戏，而是换一个工作目录；同一份客户端 jar 可以被多个实例复用。

## 非版本隔离（共享目录）

```text
.minecraft/
├─ assets/                      共享
├─ libraries/                   共享
├─ runtime/                     启动器/Java 运行时（共享）
├─ versions/
│  ├─ 1.20.1/
│  │  ├─ 1.20.1.jar            版本客户端
│  │  ├─ 1.20.1.json           版本清单
│  │  └─ natives/              解压的原生库（部分启动器）
│  └─ 1.20.1-forge/
│     ├─ 1.20.1-forge.jar
│     └─ 1.20.1-forge.json
├─ mods/                       所有版本共用
├─ config/                     所有版本共用
├─ defaultconfigs/             Forge 默认配置，共用
├─ saves/                      所有版本共用同一批存档
├─ resourcepacks/              共用
├─ shaderpacks/                共用
├─ logs/                       共用一个 latest.log / debug.log
├─ crash-reports/              共用
├─ options.txt                 共用（按键、语言、渲染设置）
├─ servers.dat                 共用
└─ screenshots/                共用
```

特征与后果：

- 版本文件夹只保存“版本定义”，不保存玩法数据；`versions/<id>/mods` 在这个模式下不会被读取。
- 不同版本、不同加载器的模组混在同一 `mods/`，极易出现缺前置、Mixin 冲突、签名不匹配。
- 存档、配置、日志共享：低版本世界可能被高版本打开，`latest.log` 会被下一次启动覆盖。
- 省磁盘、管理简单，适合只玩一个版本或原版。

官方启动器默认就是这种结构：所有安装默认指向 `.minecraft`。它允许在“安装 → 编辑 → 游戏目录”中为单个安装指定其他目录，但不提供名为“版本隔离”的开关。

## 版本隔离

以 HMCL 的默认布局为例（`--gameDir` 指向 `versions/<id>`）：

```text
.minecraft/
├─ assets/                      共享
├─ libraries/                   共享
├─ runtime/                     共享
└─ versions/
   ├─ 1.20.1-forge/
   │  ├─ 1.20.1-forge.jar
   │  ├─ 1.20.1-forge.json
   │  ├─ .hmcl/                 实例元数据（HMCL）
   │  │  └─ config/
   │  │     └─ instance-game-settings.json
   │  ├─ mods/                  仅该实例
   │  ├─ config/                仅该实例
   │  ├─ defaultconfigs/        仅该实例
   │  ├─ saves/                 仅该实例的存档
   │  ├─ resourcepacks/         仅该实例
   │  ├─ shaderpacks/           仅该实例
   │  ├─ logs/                  latest.log / debug.log
   │  ├─ crash-reports/         崩溃报告
   │  ├─ options.txt            独立按键与画面设置
   │  ├─ servers.dat            独立服务器列表
   │  └─ screenshots/           独立截图
   └─ 1.21-fabric/
      └─ …（同样的结构）
```

特征与后果：

- 每个实例有完整的运行目录，模组、配置、存档、日志互不干扰。
- 多个实例共用 `assets`、`libraries` 与 `runtime`，不会重复下载游戏资源。
- 代价是磁盘占用更高（每个实例各存一份模组与资源包），存档分散在不同目录。
- 日志与崩溃报告位置随实例变化；排查问题时必须确认 `--gameDir` 指向哪一个目录。

## 路径归属对照

| 路径 | 非隔离 | 隔离 |
| --- | --- | --- |
| `mods/` | 根目录，所有版本共用 | `versions/<id>/mods`，实例独有 |
| `config/`、`defaultconfigs/` | 共用 | 实例独有 |
| `saves/` | 共用同一批世界 | 实例独有 |
| `logs/`、`crash-reports/` | 共用，后一次启动覆盖 | 每实例独立 |
| `options.txt`、`servers.dat` | 共用 | 实例独有 |
| `resourcepacks/`、`shaderpacks/`、`screenshots/` | 共用 | 实例独有 |
| `assets/`、`libraries/`、`runtime/` | 共享 | 共享 |
| `versions/<id>/<id>.jar`、`<id>.json` | 版本自带 | 版本自带 |

## 启动器实现差异

### HMCL

- 实例根目录固定为 `versions/<id>`。
- “隔离”等价于在实例配置 `.hmcl/config/instance-game-settings.json` 中写入 `runningDirectory` 覆盖项：
  - 有覆盖项但值为空 → 运行目录为实例根 `versions/<id>`；
  - 没有覆盖项 → 运行目录为游戏根目录（`.minecraft`）；
  - 值为非空路径 → 运行到该自定义目录（可用于把实例放到任意磁盘）。
- 整合包实例（存在 `modpack.cfg`）始终运行在实例根目录。
- 新实例的默认策略由 `defaultIsolationType` 决定，默认 `MODDED`：带模组加载器的实例默认隔离，原版默认不隔离。
- `enableIsolation()` 只添加 `runningDirectory` 覆盖项，不移动任何文件。

### PCL2

- 运行目录由 `PathIndie` 决定：`VersionArgumentIndieV2` 为真时取 `PathVersion`（`versions/<id>`），否则取当前选择的游戏根目录。
- 首次判断顺序：
  1. 迁移旧的 `VersionArgumentIndie`（1 开、2 关）；
  2. 若版本文件夹下已有非空 `mods` 或 `saves`，自动开启隔离；
  3. 否则按全局 `LaunchArgumentIndieV2` 决定：`0` 关闭、`1` 仅可装 Mod 的版本、`2` 仅非正式版、`3` 非正式版或可装 Mod、`4` 全部隔离（默认）。
- 结果会写回该实例的 `versions/<id>/PCL/Setup.ini`（`VersionArgumentIndieV2`），之后不再随全局默认变化。
- 启动时 `--gameDir` 与进程工作目录都使用 `PathIndie`。

### 其他启动器

多数启动器（PrismLauncher、MultiMC、ATLauncher 等）采用“每个实例一个独立目录”的模型，实例目录通常不在 `versions/<id>` 下，而是单独的 `instances/<name>/`，其中再放 `.minecraft` 结构。原理相同：改变 `--gameDir`，共享 `assets`/`libraries`。

## 切换隔离状态的注意事项

1. **切换不会迁移文件**。打开隔离后，游戏开始在 `versions/<id>` 下找 `mods`、`saves`；原来根目录的内容不会自动复制，表现为“模组全没了”“存档不见了”。
2. 需要手动迁移的通常是：`mods`、`config`、`defaultconfigs`、`saves`、`resourcepacks`、`shaderpacks`、`options.txt`、`servers.dat`。`logs` 与 `crash-reports` 可按需保留。
3. 关闭隔离则反向操作，注意同名文件覆盖。
4. 整合包导入、版本升级或启动器迁移可能重置隔离设置；升级前先确认 `--gameDir`。
5. 同一存档在不同版本间共用（非隔离）存在存档损坏风险；重要世界建议放在隔离实例中并单独备份。

## 对本工具的影响

- 目录分析同时支持两种布局：非隔离读取根目录的 `logs`、`crash-reports`、`mods`；隔离读取 `versions/<id>/` 下的同名结构（扫描最多 3 层）。
- 若把 `.minecraft` 根目录直接交给工具，而其中存在多个隔离实例，`latest.log` 只会按路径排序取一份，可能不是刚崩溃的那个实例。**排查时应直接选择对应实例目录**（`versions/<id>`）。
- 启动器联动当前返回的是“游戏根目录”。对 HMCL 隔离实例，真实运行目录是 `versions/<id>`；后续可解析 `runningDirectory` / `VersionArgumentIndieV2` 返回实际运行目录，避免误选实例。
- 导出 zip 不受影响：导出器按运行目录收集 `logs` 与 `crash-reports`，包内路径仍是相对的。

## 参考

- HMCL：`HMCLGameRepository.computeRunDirectory()`、`GameSettings.PROPERTY_RUNNING_DIRECTORY`、`DefaultIsolationType`、`DefaultGameRepositoryLayout.getInstanceRoot()`。
- PCL2：`McInstance.PathIndie`、`LaunchArgumentIndieV2` / `VersionArgumentIndieV2`、`ModLaunch.vb` 中 `${game_directory}` 与 `WorkingDirectory`。
- Minecraft 启动参数：`--gameDir`、`--assetsDir`、`--assetIndex`。
