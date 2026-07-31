---
description: Trae 流程门禁调用协议（强制）。本规则规定 Trae 原生 Hook 与顶层代理手动自检双保险机制：.trae/hooks.json 遵循 Trae 标准格式，客户端自动拦截；顶层代理在关键操作前仍须手动调用 gate-check.mjs 自检作为兜底。适用于所有受控写入、Shell 执行、角色分派与回合收尾场景。
globs:
alwaysApply: true
---

# Trae 流程门禁调用协议（强制）

## 0. 核心义务（常驻）

本项目门禁为**双保险**：Trae 原生 Hook（第一层，确定性拦截，`.trae/hooks.json` 在 `PreToolUse` / `SessionStart` / `Stop` 事件自动触发）+ 顶层代理手动自检（第二层，兜底保障）。两层共用同一套判定逻辑（`workflow-gate-lib.mjs` + `gate-*.mjs`），判据一致；本规则不放松任何门禁（R12）。

顶层代理在下列操作**前**，**必须**先运行 `node .trae/scripts/gate-check.mjs <子命令>` 自检（即使 Hook 已可能拦截，仍须手动自检以确保兜底），读取 stdout JSON 与退出码：

- 写入 / 编辑 / 删除任意文件 → `dev-write <filepath>`
- 执行 Shell 命令（项目初始化 / 依赖安装 / 包管理等）→ `dev-shell "<command>"`
- 执行系统级工具链安装（winget / brew / apt / choco 等）→ `toolchain "<command>"`
- 发起受门禁角色 Task（`system-architect` / `requirement-reviewer` / `development-engineer` / `quality-engineer` / `test-engineer`）→ `role <role-name>`
- 拟结束当前回合（向用户交付总结）→ `stop`

> `project-manager` / `requirements-analyst` 不在 R13 门禁表（恒放行），仍建议调用 `role` 子命令以确认流程状态。

**退出码行为（强制）**：`0` 放行，继续原操作；`1`（`deny`）**立即停止**原操作，**不得改用其他工具绕过**（如 Write 被拒后改用 Shell 写文件），向用户展示 `permissionDecisionReason` / `additionalContext` 并说明须先完成的前置步骤；`2`（`decision:"block"`，仅 `stop`）不得收尾，按 `reason` 指引分派对应角色后再调 `stop` 复检。

## 1. 按需细则指针

本规则为薄宪章常驻条目，下列细则按需 Read，不在每轮重复展开（避免与说明权威重复维护、膨胀常驻上下文）：

- **子命令完整动作表与退出码语义**：见 `.trae/harness/spec/trae-adaptation.md` §0.3（每个子命令的放行 / 拒绝动作、前置条件与退出码 0/1/2 的对应）。
- **Hook matcher → 脚本映射**：见 `.trae/harness/spec/trae-adaptation.md` §0.4（`Write|Edit|...` / `Bash|RunCommand` / `Task` / `*` / `Stop` / `SessionStart` 各对应哪个 `gate-*.mjs` 与用途）。
- **回合结束前自检表**：见 `AGENTS.md` §5.15（本回合是否越权代写、是否修改受门禁源码、开发线是否待 QE、批次 / 最终 E2E / lint(R15) / 静态扫描(R16) / 启动冒烟(R32) 是否 `gatePassed`、R31 / R34 / R35 / R37 / R38 / R40 等自检项）。`gate-check.mjs stop` 是自检表的机械兜底，**不替代文字自检**——**调用者身份判定**（顶层代理 vs 子 agent 越权）无法机械化，仍由 `AGENTS.md` §5 的 R5 / R8 文字约束承担。
- **fail-open 边界与机械层实际强度**：见 `.trae/harness/spec/mechanical-gates.md` §8.7（Hook 只提高抄近路成本、非不可逾越沙箱；哪些判据 fail-open、哪些不可伪造）。门禁路径分级与 R28 / R29 判据见同文件 §8.5。
- **角色 Subagent 加载与协同**：见 `AGENTS.md` §1（7 角色由内置 "Agent" 按 `description` 匹配调用，拥有独立上下文窗口）。各角色 Subagent 系统提示词已收纳本规则引用（「门禁前置：见 `.trae/rules/gate-protocol.md`」），由 Subagent 文件本身承载，**顶层代理调用 Task 时无需在 `prompt` 中再注入**，仅传递任务上下文（用户目标、`process.md` 路径、已有成果物路径、PM 分派计划），不得越权代行角色职责。
