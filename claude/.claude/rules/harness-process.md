---
paths:
  - "docs/**/process.md"
  - ".claude/harness-state.json"
---

# 流程台账（process.md）编辑提醒

`process.md` 是全部机械门禁的**输入面**：`workflow_mode` / `iterationType` / `blocking` /
`cancelled` / 进度表 / `## 用户确认记录` 都在这里被 Hook 解析。改错一格即改变裁决。

- **编排硬约束**：根目录 `CLAUDE.md`（顶层禁令 §5、门禁链摘要 §6、能力边界 §3）。
- **模式分诊 / R2 / R20 / R10 冻结**：`.claude/harness/spec/workflow-modes.md` 与 `.claude/agents/project-manager.md`。
- **R9 与无效成果物清单**：`.claude/harness/spec/gate-chain.md`。
- **客观公式与 stop 判据**：`.claude/harness/spec/mechanical-gates.md`。
- **只有项目经理写这个文件**（R21 角色↔路径）；顶层代理改它以跳过门禁属 R5 违规。
- **豁免须双要素**：`gated-artifacts.json` 声明 + 本文件 `## 用户确认记录` 机读行，**仅一项不生效**。
- **确认行必须对应真实的 `AskUserQuestion`**。Hook 只验「确认行存在」，验不了「是否真问过」——
  写了确认行却没真问，是本框架最严重的违规（`mechanical-gates.md` §8.7 边界 1）。
- **`cancelled: true` 不可逆**：写入后 Hook 永久冻结本文件，不得恢复，只能引导新流程（R10）。

执行权威始终是 Hook；本文件的任何写法都不能单独放宽判据（**R12**）。
