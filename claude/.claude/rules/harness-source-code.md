---
paths:
  - "src/**"
  - "app/**"
  - "lib/**"
  - "server/**"
  - "client/**"
  - "backend/**"
  - "frontend/**"
  - "components/**"
  - "pages/**"
  - "api/**"
  - "services/**"
  - "package.json"
  - "pyproject.toml"
  - "go.mod"
  - "Cargo.toml"
  - "pom.xml"
  - "Dockerfile*"
---

# 产品源码写入提醒

受门禁源码只有**一条**合法写入通道：项目经理已分派 → 对应子 agent 在 Agent 调用内写入。

- **顶层代理不得代写（R5）**：Hook 用 `conversation_id` 识别顶层身份并直接 deny。
  「Write 被拒 → 改用 Shell」同样被拦（**R28**：命令行提到受门禁路径即裁决）。
- **期望角色为 development-engineer（R21）**：最近派发角色若是 TE/QE，即便进度表残留 DE 行
  也直接 deny。E2E 测试树（`e2e/`）例外，期望角色为 test-engineer（**R23**）。
- **须在分派范围内**：只实现项目经理分派给本开发线的任务包编号，不得合并任务包、不得越界
  改其他开发线的文件。
- **R3 四件成果物**：本轮迭代须有有效的需求/设计/任务清单/分派记录，缺一即 deny。
- **`docs-only` 模式禁止写源码与构建产物**（含 `e2e/`）；`cancelled: true` 后一切写入永久冻结（**R10**）。
- **工程化基建归 DE**：构建/测试脚本、`package.json` scripts 属本通道；但 `.claude/**` 下的
  门禁自身**不属于**，见 `.claude/rules/harness-gate-assets.md`（**R29**）。
- **工具链安装须用户批准**：走「检测 → 询问 → 确认 → 安装」，`gate-toolchain-install` 会以
  `ask` 请用户批准；禁止自签 `.toolchain-install-approved.json`。
- **先看 R25 同构模块识别**：`detail-design-spec.md` 已声明的共享 primitive 要复用。并行开发
  各自「复制改」会在 QE 阶段被 **R16** 重复率门禁打回（默认阈值 5%）。
- **功能代码须有配套单元测试**——这是 QE 分派的前置。

说明权威见 `.claude/harness/spec/mechanical-gates.md` §8.5；执行权威是 Hook。
