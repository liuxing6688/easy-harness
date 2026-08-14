# Harness Engineering 规约框架

跨技术栈 AI 编程流程规约。本仓库是**多适配容器**：同一套 Harness Engineering 通用规约，按不同编辑器/Agent 工具各维护一份**以自身目录为根、彼此平级、互不耦合**的完整适配。

**建议阅读顺序**

1. **选型与开工**：本页「适配一览」→「工作区根」→ 对应适配 README 的「快速开始」/「接入项目」
2. **理解流程**：各适配 README 的框架全景 / 工作流模式（含 R20 轻量确认、R37 增量迭代档、§8.4–§8.8 硬化项；Trae §8.9 为 **R40** 闭环锁，Claude §8.9 为原生规则层，Codex 另有 `.codex/rules/*.rules` 沙箱外命令策略）
3. **改规约 / 维护**：各适配「规约权威分层」与「框架自测」；本页「未来扩展」仅在新增适配时需要

## 适配一览

| 适配目录 | 说明 | 状态 |
| -------- | ---- | ---- |
| `cursor/` | 适配 Cursor（自动 Hook 门禁、7 子角色、脚本/模板；含 R5 会话追踪与角色↔路径、§8.4 R21–R24、§8.5 审核加固 R28–R31、§8.6 交付可用性 R32–R33、§8.8 审核加固 R34–R38；`single-task` = **R37** 增量迭代档） | 可用 |
| `trae/` | 适配 Trae（原生 Hook + `gate-check` 手动兜底双保险、7 Subagent、脚本/模板；同上共享门禁族 + Trae 侧 **R39** 分派计划匹配 / `gate-r13-subagent`、**R40** 闭环锁） | 可用 |
| `codex/` | 适配 OpenAI Codex 本地客户端（ChatGPT 桌面 / CLI / IDE 扩展；7 个 custom agents + lifecycle Hooks；顶层 `read-only` sandbox 替代 Cursor 式 `conversation_id` 身份隔离；`.codex/rules/harness.rules` 沙箱外命令前缀策略；运行时状态在 `.harness/`） | 可用 |
| `claude/` | 适配 Claude Code（v2.0 技术强制：SessionStart / PreToolUse / Stop / SubagentStart Hooks、7 Agents、脚本/模板；根宪章为 `CLAUDE.md`；Hook 权威源为 `.claude/settings.json`；共享门禁族与 Cursor 对等，含 R5 会话追踪与角色↔路径、§8.4 R21–R24、§8.5 审核加固 R28–R31、§8.6 交付可用性 R32–R33、§8.8 审核加固 R34–R38；`single-task` = **R37** 增量迭代档；§8.9 原生规则层 `.claude/rules/*.md`，`paths` 触发） | 可用 |

> **切勿**把外层 `easy-harness/` 当作工作区根——容器层没有 `.cursor/` / `.trae/` / `.codex/` / `.claude/` / `AGENTS.md` / `CLAUDE.md`，门禁与角色会**静默失效**。正确打开方式见下一节。

## 工作区根（重要）

仓库根 `easy-harness/` 只是容器（`.git` 在此），**本身不作为工作区根**。使用某一适配时，二选一：

- 直接把对应适配目录（如 `easy-harness/cursor/`、`easy-harness/trae/`、`easy-harness/codex/`、`easy-harness/claude/`）作为工作区根打开；或
- 把该适配目录的**全部内容**复制到宿主项目根，再以宿主项目为工作区根。

日常用法、目录结构、配置与自测命令见各适配 README：

- [`cursor/README.md`](cursor/README.md)
- [`trae/README.md`](trae/README.md)
- [`codex/README.md`](codex/README.md)
- [`claude/README.md`](claude/README.md)

## 前置条件

- 各适配的门禁与初始化脚本依赖 **`Node.js >= 18`**（执行 `.mjs`；R16 静态扫描亦经 `npx` 跨技术栈获取工具）。
- 框架**不预置** `package.json`（避免整体复制时覆盖宿主清单）。E2E 需宿主安装 `@playwright/test` + Chromium；框架自测的纯函数单测需 `vitest`。细则与安装提示见各适配 README「前置条件」。
- Trae 适配另需 **Trae IDE ≥ v3.5.67**（Subagent 目录 + Hooks），且 **Hooks 须在 UI 中显式启用**并重载窗口/新建会话，详见 [`trae/README.md`](trae/README.md)。
- Codex 适配另需：**将项目标为 trusted**（否则跳过项目级 `.codex/config.toml` / hooks / `rules`）、首次与 Hook 变更后在 `/hooks` 中审阅并信任当前 hash；详见 [`codex/README.md`](codex/README.md)。
- Claude Code 适配另需：**已安装 Claude Code**（CLI / Desktop / IDE 扩展）；Hook 配置以 **`.claude/settings.json` 为唯一权威源**（勿依赖 `.claude/hooks/hooks.json`；生效的是 `gate-dev-workflow-enhanced` / `session-init-enhanced`，同名非 enhanced 文件未注册）；命令路径占位符须用 `${CLAUDE_PROJECT_DIR}`；可用 `/hooks` 与 `claude --debug` 确认已注册。细则见 [`claude/README.md`](claude/README.md)。
- 目标项目的业务技术栈不限；具体运行时、包管理器与测试工具由系统架构师在设计阶段声明。

## 共享能力速览

各适配均已采用**薄宪章架构**：根 `AGENTS.md` / `CLAUDE.md`（或该工具等价入口）只常驻编排硬约束与权威索引；客观判据以 Hook/脚本为**执行权威**；长公式与细则在各自 `{.cursor|.trae|.codex|.claude}/harness/spec/`；角色操作细则在 `agents/*`（分派时注入）。Cursor / Trae / Claude 另有路径触发的**提示词规则层**（只做提醒与转述，不新增约束；Claude 为官方 `.md` + `paths`，Cursor/Trae 为 `globs`）。Codex 无 glob 提示词机制，另有 **Rules 沙箱外命令策略**（`.codex/rules/*.rules` 的 `prefix_rule`，当前仅 `prompt`；属 R29 `gate-config`，不覆盖 Hook `deny`）。**根文件变薄 ≠ 规约变松。** 完整分层说明见各适配 README「规约权威分层」。

| 主题 | 要点 |
| ---- | ---- |
| **编排** | 7 角色分工；顶层不得代写（**R5**）或越级分派（**R8**）；PM 维护 `process.md`。Cursor/Trae/Claude 另有身份基准与子代理追踪；Codex 以顶层 `read-only` + 角色 `workspace-write` 为主隔离 |
| **模式** | `full` / `hotfix` / `docs-only` / `single-task`；轻量模式须 **R20**（用户确认 + 机读确认行）后方可生效，未确认 fail-safe 为 `full`。`single-task` = **R37** 增量迭代档：已有基线设计上加功能；**只省**测试轮次折叠与 R26，**不省** R14/R17/R32 等其余判据 |
| **需求与设计** | **R19** 隐性需求机读后方可派架构师；**R33** 界面与交互期望确认后方可派架构师；**R25** 同构模块识别后方可派评审；设计问题清单经 **R18** 机读后方可进入开发；选型确认 **R26**、需求摘要确认 **R27**（文字约束；`single-task` 豁免 R26） |
| **质量门禁** | R15 lint（跨栈探测表 ⊇ `buildManifests`；无安全默认的栈须**你本人**写 `qe.commands`）、R16 静态扫描；批次含 E2E、**R14** 接口测试、**R17** 存储对账、**R32** 生产启动冒烟、**R22** TE 替代启动负向拦截；**R34** 执行证明 / **R38** 工具不可用分类为机读判据链前置；无对外接口 / 无 UI / 无持久化等走**双要素豁免** |
| **路径与硬化** | **R6** 代码扩展名默认门禁；**R21/R23** 角色↔路径 / `e2e/**`；**§8.5**：**R28** Shell/RunCommand 写文件、**R29** 门禁自治 deny、**R30** BOM/UTF-16 安全读盘、**R31** 回退上限；**§8.6** R32–R33；**§8.8**：**R35** 阻塞释放证据、**R36** 判定期异常 fail-closed、R34/R37/R38；TE **R24** 禁改用例掩盖缺陷（文字） |
| **机械实现** | Hook 逻辑按域拆在 `hooks/lib/*`（含 `execproof.mjs`；`workflow-gate-lib.mjs` 为薄 barrel）；运行器含 `startup-smoke-run.mjs`、`tool-availability-lib.mjs`；自测拆为 `scripts/tests/selftest/` 与 `scripts/tests/scenarios/` |
| **工具差异** | **Cursor**：Hook 自动拦截为主（含 `gate-subagent-track` 落盘顶层会话）。**Trae**：原生 Hook + `gate-check.mjs` 双保险，另有 `gate-r13-subagent`、**R39** 分派计划匹配、**R40** 闭环锁。**Codex**：`codex-hook-adapter` 做 wire-format 适配；顶层 `read-only` sandbox；`ask` 降级为 `deny`；`.codex/rules/harness.rules` 对沙箱外命令按前缀 `prompt`（不覆盖 Hook `deny`）；运行时台账在 `.harness/`（因 `.codex/` / `.agents/` 原生只读）；Stop 允许一次 continuation。**Claude Code**：根宪章 `CLAUDE.md`；Hook 权威源 `.claude/settings.json`（SessionStart / PreToolUse matcher `Write\|Edit\|NotebookEdit`、`Bash\|PowerShell`、`Agent` / Stop / SubagentStart，共 7 个已注册脚本）；发起角色用 Agent 工具、确认用 `AskUserQuestion`；路径占位符 `${CLAUDE_PROJECT_DIR}`；规则层为 `.claude/rules/*.md`（官方 `paths` 触发，不是 Cursor 的 `.mdc` / `globs`；属 **R29** `gate-config`，说明见 §8.9）；与 Cursor 对等的技术强制 |

编号导航与公式细节以各适配 `harness/spec/` 为准，本页不重复以免漂移。

## 未来扩展

后续需要适配新的编辑器/Agent 工具时，无需改动已有适配，按如下方式新增即可：

1. 在仓库根**新增一个与 `cursor/` / `trae/` / `codex/` / `claude/` 平级的目录**（目录名取该工具名，如 `<tool>/`）。
2. 在该目录下实现一套**以自身为根、完整自洽**的适配。建议沿用薄宪章分层（不必与已有适配文件名一一对应，但应分清）：
   - **常驻宪章**：根目录 `AGENTS.md` / `CLAUDE.md`（或该工具等价入口）——编排硬约束，不堆公式长文；
   - **机械执行**：该工具的 Hook/门禁脚本（客观判据唯一执行权威，R12 只可加强）；建议按域拆分 `hooks/lib/*`（含执行证明等横切能力），并配套 `scripts/tests/{selftest,scenarios}/`；
   - **说明权威**：如 `harness/spec/`——公式、豁免表、模式细则、审核加固（§8.4–§8.8；工具特有项可另开 §8.9 等章节），供人审与改门禁；
   - **角色执行面**：子 agent / Subagent / custom agent 定义；
   - **规则层（若该工具支持）**：按该工具官方语义接入，勿照抄其它适配。路径注入提醒（Claude `.md` + `paths`，Cursor `.mdc` + `globs`）只转述、不新增约束；硬禁令须同时留在宪章、角色文件或 Hook。命令策略类规则（如 Codex `.rules` 的 `prefix_rule`）只裁决沙箱外命令，不承担角色/路径/阶段判据，且不得配置项目级 `allow` 削弱顶层隔离；
   - 以及模板、`.gitignore`、自测入口脚本等运行时依赖。
3. 具体拆分哪些角色、用何种门禁机制，由该工具能力决定。
4. 该适配同样以「作为工作区根打开」或「整体复制到宿主项目根」两种方式使用；其 `.gitignore` 随适配目录一并复制。

> 各适配自成一体、互不引用（含各自的 `.gitignore`），因此新增或调整某个适配不会影响其它适配。
