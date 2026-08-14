# Harness Engineering（Codex 适配版）

适配 OpenAI Codex 本地客户端（ChatGPT 桌面应用中的 Codex、Codex CLI、Codex IDE 扩展）的跨技术栈 AI 编程流程规约。将本目录作为 Codex workspace 根，或整体复制到目标项目后使用。

规约采用**分层权威**（薄宪章常驻 + Rules 沙箱外命令策略 + Hook 机械强制 + 角色执行面 + `harness/spec` 说明细则）。

**建议阅读顺序**：

1. **日常使用**：前置条件 → 快速开始（读到这里即可开工）
2. **理解流程**：工作流 → Codex 能力映射
3. **接入与调参**：目录结构 → 配置说明
4. **改规约 / 维护**：规约权威分层 → 框架自测 → 能力边界

本适配以 2026-08-14 的官方文档为准：[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) · [Rules](https://learn.chatgpt.com/docs/agent-configuration/rules) · [Config](https://learn.chatgpt.com/docs/config-file/config-basic) · [Hooks](https://learn.chatgpt.com/docs/hooks) · [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) · [Skills](https://learn.chatgpt.com/docs/build-skills) · [Sandbox](https://learn.chatgpt.com/docs/agent-approvals-security)

## 前置条件

- **Codex workspace root**：以本目录或接入后的目标项目根作为 Codex workspace。Hook 相对 session `cwd` 调用 `.codex/hooks/codex-hook-adapter.mjs`，不依赖 Git。
- **Node.js ≥ 18**，用于 `.mjs` hooks、运行器与自测。
- **项目须标为 trusted**：未信任时 Codex 会跳过项目级 `.codex/config.toml`、hooks 与 rules。
- **信任 hooks**：首次启动后执行 `/hooks`，审阅并信任当前 hash；Hook 内容变化后须重新信任。
- **E2E**：宿主安装 `@playwright/test` + Chromium。框架不预置 `package.json`，避免覆盖宿主清单。

本适配的 custom agents 当前使用 `gpt-5.6` 与 `gpt-5.6-terra`。若账户/部署不提供这些模型，由**你本人**改 `.codex/agents/*.toml` 中的 `model`；不要让顶层 agent 临时换模型绕过角色配置。

## 快速开始

**方式一：以本目录为 workspace。** 确认项目 trusted，在 `/hooks` 中信任 hooks，向 AI 提目标即可。

**方式二：接入已有项目。** 把本目录全部内容复制到目标项目根（即计划作为 Codex workspace 的目录），至少包括：

- `AGENTS.md`
- `.codex/`
- `.agents/`
- `.gitignore`
- `playwright.config.ts`
- `e2e/specs/README.md`

然后以该目录启动 Codex，确认 trusted 并信任 hooks。可位于任意 Git 层级，也可完全不在 Git 仓库中。

项目配置把顶层会话设为 `read-only`，7 个角色 agent 使用 `workspace-write`——这是「顶层只编排、角色负责产出」的主要隔离手段。

1. **向 AI 提出目标**，例如：

   > 请按 Harness 流程开发一个 XXX 工具，技术栈待定。

2. **顶层应先启动 `project-manager`**。PM 会运行 `node .codex/scripts/bootstrap-docs.mjs`（Feature 迭代加 `--feature=<名称>`），初始化 `docs/` 并写入 `.harness/harness-state.json`，再按 `process.md` 分派列表推进。

3. **用户确认**：规约中的 `AskQuestion` 指 Codex **直接向你提问并等待回答**（不是某个同名工具）。未经真实问答不得伪造 `## 用户确认记录`。

> 开工后若要弄清「谁在干什么、有哪些模式」，继续读下一节「工作流」。

## 工作流

| 角色 | custom agent | 主要职责 |
| ---- | ------------ | -------- |
| 项目经理 | `project-manager` | 接收目标、确认模式、维护进度与角色分派 |
| 需求分析师 | `requirements-analyst` | 苏格拉底式澄清、需求说明与清单 |
| 系统架构师 | `system-architect` | 技术选型、详细设计、任务包与门禁适用性 |
| 需求评审专家 | `requirement-reviewer` | 独立审核设计成果，不参与需求挖掘 |
| 开发工程师 | `development-engineer` | 最小实现、单元测试与整改 |
| 质量工程师 | `quality-engineer` | 代码审查、lint、静态扫描与依赖审计 |
| 测试工程师 | `test-engineer` | 构建、集成测试、E2E、接口/存储检查与启动冒烟 |

**模式捷径**（须 **R20** 用户确认 + 机读确认行后生效，未确认 fail-safe 为 `full`）：

- `full`：PM → RA → SA → RR → DE → QE → TE（批次 + 最终测试两级）
- `hotfix`：跳过完整 RA/SA（须 R9 最小设计）；QE 与测试不省；测试按 **R11** 折叠为单次
- `docs-only`：仅文档范围，不触发开发质量链
- `single-task`：**增量迭代档（R37）**——已有基线设计上加功能；测试折叠为一轮，但 R14/R17/R32 等判据不减；涉及 schema 变更须改回 `full`

取消流程须二次确认；`cancelled: true` 后该 `process.md` 永久冻结。细则见 `.codex/harness/spec/workflow-modes.md`。

## Codex 能力映射

| Cursor 规约能力 | Codex 实现 |
| --------------- | ---------- |
| 根规则常驻 | 根 `AGENTS.md`，Codex 启动时按目录链加载 |
| `.mdc` 按 glob 提醒 | Codex 无同构提示词机制；两条路径规则以条件化条款常驻 `AGENTS.md` §8 |
| 角色 agent | `.codex/agents/*.toml` custom agents（`developer_instructions`） |
| 项目设置 | 受信任项目的 `.codex/config.toml` |
| 沙箱外命令策略 | `.codex/rules/harness.rules` 的原生 `prefix_rule` |
| 写入门禁 | `PreToolUse` 匹配 `apply_patch` / `Edit` / `Write`，适配器解析 patch 路径 |
| Shell 门禁 | `PreToolUse` 匹配 `Bash`，依次跑工具链安装门禁与开发 Shell 门禁 |
| 角色顺序门禁 | `PreToolUse` 匹配 `Agent` / `spawn_agent` |
| 子 agent 启动记录 | `SubagentStart` |
| 未闭环自动继续 | `Stop` 返回 `decision: block`；已处于 continuation 时停止递归 |
| 按需复盘 | `.agents/skills/project-retrospective/`，用 `$project-retrospective` 显式调用 |
| 用户批准 | Codex Rules + 原生 sandbox + `approval_policy = "on-request"` |

> **注意**：`PreToolUse` 当前不支持 `permissionDecision: "ask"`。旧门禁内核出现 `ask` 时，适配器保守转为 `deny`——须先在对话中问你，再由你执行命令或走 Codex 原生批准。工具链安装不会因重复调用而自动放行。

## 目录结构

```text
codex/                        # 适配 Codex 的完整规约根——作为 workspace，或整体复制到宿主项目根
├── AGENTS.md                 # 薄宪章（常驻）
├── README.md                 # 本文件
├── .gitignore
├── .agents/
│   └── skills/project-retrospective/   # 显式复盘 skill
├── .codex/                   # 框架机件（Codex 原生只读保护）
│   ├── config.toml           # 顶层 read-only、hooks、多 agent 开关
│   ├── hooks.json
│   ├── harness.config.json
│   ├── rules/harness.rules   # 沙箱外命令前缀策略（受信任项目启动时加载）
│   ├── agents/*.toml         # 7 个角色
│   ├── hooks/
│   │   ├── codex-hook-adapter.mjs / codex-adapter-lib.mjs
│   │   ├── gate-*.mjs
│   │   └── lib/*.mjs
│   ├── scripts/
│   ├── templates/
│   └── harness/spec/
├── .harness/                 # 运行时状态（可写，已 gitignore）
├── docs/                     # 流程成果物（首次运行后生成）
├── e2e/specs/
├── playwright.config.ts
└── test-results/             # 质量与测试机读产物（已 gitignore）
```

Codex 原生把可写根中的 `.codex/` 与 `.agents/` 递归保护为只读。因此静态配置放在受保护目录；需要写入的活跃流程指针、角色派发记录、执行证明 nonce 和门禁异常台账统一放在 `.harness/`。**不要**把运行时文件迁回 `.codex/`，否则 workspace-write agent 无法完成正常流程。

## 配置说明

- **门禁路径 / 适用性 / 质量命令**：`.codex/harness.config.json`
- **活跃流程**：`.harness/harness-state.json`（可用 `HARNESS_PROCESS_PATH` 临时覆盖）
- **项目额外受保护路径**：`docs/**/design/gated-artifacts.json`，仅 SA 写入；放松项仍须用户确认形成双要素
- **QE 命令覆盖**：`.codex/harness.config.json` → `qe.commands`
  - 未声明时：`qe-run.mjs` / `lint-run.mjs` 共用 `lint-run-lib.mjs` 探测表（覆盖面须 ⊇ `gatedPaths.buildManifests`）
  - 需要覆盖时：monorepo、探测不准，或无安全默认 lint 的栈（Maven/Gradle/PHP/CMake/Make）——**由你本人编辑**；代理只能呈现 `test-results/qe/.lint-result.json` 的 `remediation.configSnippet`
- **根 sandbox / hooks / 多 agent**：`.codex/config.toml`
- **沙箱外命令批准策略**：`.codex/rules/harness.rules`
- **模型 / 推理强度 / 角色 sandbox**：`.codex/agents/*.toml`

`.codex/**`、`.agents/**`、`AGENTS.md` 与 `harness/spec/**` 是治理资产。Codex 原生保护前两者；Hook 继续拒绝代理改写治理资产及 `.harness/` 中的授权/证明台账。

### Codex Rules 层

Codex 会在启动时扫描每个活跃配置层的 `rules/*.rules`；项目级 `.codex/rules/` 只有在项目受信任时加载，修改后须重启 Codex。Rules 目前是实验能力，文件使用无副作用的 Starlark。

在 TUI 把命令加入 allow list 时，Codex 写入的是用户层 `~/.codex/rules/default.rules`，不是本项目文件；Smart approvals 也可能在提权时建议规则前缀，接受前须核对范围。团队/用户/项目层规则共同生效，管理员还可通过 `requirements.toml` 强制更严格的前缀策略。

`prefix_rule` 按**命令参数的精确前缀**匹配，`pattern` 的单个位置可写字面量并集；`decision` 为 `allow`、`prompt` 或 `forbidden`。多条命中时取最严格结果：`forbidden > prompt > allow`。`justification` 用于批准/拒绝说明，`match` 与 `not_match` 是加载时执行的内联样例。

本规约的 Rules 层只使用 `prompt`，为四类已有命令约束提供沙箱外批准与后备防线：项目初始化/依赖变更、系统工具链安装、外部网络下载、无法静态归属路径的 Git 工作树改写。Hook 的 `deny` 仍优先生效，Rules 不会把拒绝改成可批准。**不配置项目级 `allow`**，因为规则无法区分顶层协调会话与业务角色；自动放行会削弱根 `read-only` 的 R5 隔离。

Rules 只在 Codex 请求命令**逃逸沙箱**时裁决，不能表达文件 glob、调用角色、工作流阶段、文档内容、用户确认真伪或 `execProof`。因此下列能力仍分别由 `AGENTS.md` 与 Hook/运行器承担：

| 能力 | 权威层 |
| ---- | ------ |
| Cursor 两条 `.mdc` 路径提醒 | `AGENTS.md` §8 的路径条件条款 |
| R5/R21/R23 角色与路径、R28 可解析写入、R29 治理资产 | `PreToolUse` Hook |
| R13 阶段顺序、R14–R18/R32/R34/R38 产物与质量判据 | Hook / `*-run.mjs` |
| R20/R26/R27/R33/R35 的真实用户问答 | 角色约束 + 顶层自检 |

对 `bash -lc`、`bash -c` 及 `sh`/`zsh` 同类包装，Codex 仅在脚本由普通参数和 `&&`、`||`、`;`、`|` 组成时安全拆分并逐命令裁决；一旦包含重定向、变量、替换、通配符或控制流，规则只看到整个 Shell 包装调用。PowerShell 包装也不保证拆分。因此 Rules 是沙箱外批准层，不替代 R28 的路径解析与 Hook 拒绝。

## 规约权威分层

| 层 | 路径 | 作用 |
| -- | ---- | ---- |
| 常驻宪章 | `AGENTS.md` | 顶层禁令、模式摘要、门禁链摘要、自检与权威索引 |
| 沙箱外命令策略 | `.codex/rules/*.rules` | 命令前缀的批准、禁止或放行策略；当前仅使用 `prompt` |
| 角色执行面 | `.codex/agents/*.toml` | 7 个角色的职责、输入、输出和内部流程 |
| 机械执行 | `.codex/hooks/**`、`.codex/scripts/*-run.mjs` | 路径、阶段、质量与测试判据 |
| 说明权威 | `.codex/harness/spec/**` | 公式、例外、编号与能力边界 |
| 模板 | `.codex/templates/**` | `process.md`、需求、设计、质量与测试成果物结构 |
| 可复用工作流 | `.agents/skills/project-retrospective/**` | 显式项目复盘 |

客观判据以 Hook/运行器代码为执行权威；说明文档须与代码同向更新。后续修改只可加强规约；任何放松须由你裁定并留痕。

## 框架自测

修改 hooks、适配器、运行器或模板后，至少先跑前两项：

```bash
# 门禁纯 Node 自测（含 Codex wire-format 适配）
node .codex/scripts/gate-selftest.mjs

# 端到端 Hook 场景回归（spawn 五个门禁入口）
node .codex/scripts/gate-scenarios.mjs

# 纯函数单测（需宿主安装 vitest）
npx vitest run --config .codex/scripts/vitest.config.ts

# Rules 语法、内联样例与命中结果（预期分别为 prompt / 无 decision 字段）
codex execpolicy check --pretty --rules .codex/rules/harness.rules -- npm install
codex execpolicy check --pretty --rules .codex/rules/harness.rules -- npm run test
```

## 能力边界

以下部分无法与 Cursor 一比一映射，适配采用等效或更保守策略：

1. **Rules 不等于 `.mdc`**：Codex Rules 只裁决沙箱外命令，不能按 glob 注入提示词；原两条 `.mdc` 已按路径条件迁入 `AGENTS.md` §8，路径相关拒绝继续由 `PreToolUse` Hook 执行。
2. **无稳定的「当前 subagent id」**：不能照搬 Cursor 的 `conversation_id` 顶层识别；改用根 `read-only` + 角色 `workspace-write`，角色↔路径仍由 Hook 执行。
3. **CLI / 用户配置可覆盖项目 sandbox**：`--sandbox workspace-write`、`danger-full-access`、`--yolo` 会削弱顶层隔离；本规约禁止这样运行。
4. **部分 specialized/hosted tools 可绕过本地 tool-hook**：Hook 是 guardrail，不是完整沙箱；sandbox、`.codex`/`.agents` 保护路径与回合自检仍须保留。
5. **`PreToolUse` 不支持 `ask`**：旧 ask 判据降级为 deny；授权改走对话确认 + Codex 原生 approval。
6. **Stop continuation 无 `loop_limit`**：适配器允许一次自动 continuation，`stop_hook_active=true` 时停止递归；之后靠 `AGENTS.md` 自检与你下一轮继续。
7. **保证范围是 Codex 本地客户端**：cloud 是否完整加载本目录的 agent/hook/sandbox 组合，不在本适配保证范围内。

这些边界**不构成跳过规约的许可**。若 hooks 未受信任、项目未 trust、模型不可用或 sandbox 被覆盖，应先修复环境或将流程标为阻塞，不得把缺失的机械约束解释成自动放行。
