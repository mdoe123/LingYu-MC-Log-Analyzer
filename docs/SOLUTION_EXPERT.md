# 专业版解决方案：Oculus × Embeddium 的 GameRenderer 注入冲突

> 案例来源：项目内置示例日志。版本号为示例值，实际以模组发布页与兼容矩阵为准。
> 同类问题可复用本结构：先定阶段，再看 Caused by 链，最后用版本组合与二分法验证。

## 结论

| 项目 | 内容 |
| --- | --- |
| 现象 | 初始化阶段（`Rendering screen`）Mixin 注入失败，`GameRenderer` 变换中止 |
| 根因 | Oculus 1.7.0 的 `GameRendererMixin` 在 `onResize` 注入时找不到目标 `GameRenderer.m_109093_`；Embeddium 0.3.31 已改写该调用链，二者版本组合不兼容 |
| 性质 | 版本组合问题，非配置错误、非存档损坏、非内存或 Java 环境问题 |
| 置信度 | 0.92（崩溃报告 + `latest.log` 双重证据） |
| 影响范围 | 仅客户端渲染初始化；服务端与存档未受影响 |

## 证据链

| 来源 | 位置 | 内容 | 判读 |
| --- | --- | --- | --- |
| crash-report | `Description` | `Rendering screen` | 失败发生在渲染初始化阶段 |
| crash-report | 顶层异常 | `RuntimeException: Mixin transformation of net.minecraft.client.renderer.GameRenderer failed` | Mixin 变换阶段中止 |
| crash-report | `Caused by` #1 | `InvalidInjectionException: @Inject annotation on onResize could not find any targets matching 'm_109093_'` | 注入锚点不存在 |
| crash-report | `Caused by` #2 | `NoSuchMethodError: 'org.joml.Matrix4f ... GameRenderer.m_109093_()'` | 目标方法签名缺失 |
| crash-report | 首个非原版帧 | `oculus.mixin.GameRendererMixin.onResize` | 直接指向 Oculus |
| latest.log | 第 12041 行 | `Mixin apply for mod oculus failed` | 日志直接点名 Oculus |
| latest.log | 第 12044 行 | `at oculus.mixin.GameRendererMixin.onResize` | 与崩溃报告互相印证 |
| 环境 | 报告头部 | Forge 47.3.0 / MC 1.20.1 / Java 17.0.8 / 47 mods / 8 GB | 版本与内存均匹配要求 |

## 机理

1. Minecraft 1.20.1 的 `GameRenderer` 提供返回 `Matrix4f` 的投影矩阵方法（SRG 名 `m_109093_`），Oculus 的 `GameRendererMixin` 以该方法作为注入锚点。
2. Embeddium 对渲染管线做重写，改变了 `GameRenderer` 的调用链与目标方法在变换后类中的存在形态。
3. Mixin 在应用 `oculus.mixins.json` 时解析注入点失败，抛出 `InvalidInjectionException`；随后调用点退化为 `NoSuchMethodError`，渲染初始化被迫中止。
4. 单装任一模组均可启动、共存即失败，这是版本组合问题的典型特征；与内存、Java、存档、驱动无关。

## 处置矩阵

| 优先级 | 方案 | 具体操作 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| P0 | 对齐版本 | Embeddium 升至 0.3.32+ 或回退 0.3.25，Oculus 保持 1.7.0；只改一个变量 | 低 | 冷启动 + 进入世界 |
| P0 | 临时移除 Oculus | 不使用光影时移除 `oculus-1.7.0.jar`，可立即恢复启动 | 低 | 启动到主菜单 |
| P1 | 清理缓存 | 删除 `config/oculus` 与 `shaderpacks` 下的缓存，排除旧缓存干扰 | 极低 | 启动 + 切换光影 |
| P2 | 二分定位 | 禁用含渲染 Mixin 的模组，每轮保留 `latest.log` | 中 | 逐轮收敛到具体模组 |

建议顺序：先 P0 对齐版本；若无法确认兼容组合，再临时移除 Oculus 恢复可用；P1/P2 用于排除残余因素。

## 验证与回归

- 冷启动到主菜单，确认无异常退出；
- 进入一个世界，运行 5–10 分钟，并切换一次光影；
- `latest.log` 中不再出现 `Mixin apply for mod oculus failed` 与 `NoSuchMethodError`；
- 保留改动前后的 `mods` 清单与日志快照，记录每次只改动的项，便于回滚与复盘。

## 已排除项

| 可能原因 | 排除依据 |
| --- | --- |
| 内存不足 | 无 `OutOfMemoryError`，最大内存 8192 MB |
| Java 版本不匹配 | Java 17.0.8 与 1.20.1 要求一致 |
| 缺少前置 | 无 `ClassNotFoundException` / `Missing dependencies` |
| 存档损坏 | 失败发生在 `Rendering screen`，尚未进入世界 |
| 显卡驱动 / JVM 崩溃 | 无 GLFW/OpenGL 错误，无 `hs_err_pid` 日志 |

## 回滚

- 恢复备份的 jar 文件即可；不要删除 `saves`。
- 升级 Embeddium 后若出现新问题，回退到原版本并保留日志，避免连续改动导致证据丢失。

## 若仍失败

需要补充的材料：

1. 完整 `latest.log` 与最新 crash-report；
2. `mods` 目录完整清单；
3. Forge、Oculus、Embeddium 的精确版本号；
4. 是否使用光影包、光影版本，以及是否改动过 `config/oculus`。

进一步方向：

- 查 Oculus 与 Embeddium 的 issue 区是否已有相同签名（`m_109093_` / `onResize`）的报告；
- 评估替代组合（更换渲染后端或光影方案），以发布页的兼容矩阵为准；
- 若必须保留当前组合，可考虑锁定版本并禁止启动器自动更新模组。
