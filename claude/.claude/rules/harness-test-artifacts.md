---
paths:
  - "docs/**/test/**"
  - "docs/**/quality/**"
  - "test-results/**"
  - "e2e/**"
---

# 测试 / QE 产物编辑提醒

- **R15/R16（lint / 静态扫描）**：执行面见 `.claude/agents/quality-engineer.md`；
  说明权威见 `.claude/harness/spec/mechanical-gates.md` §8.2。
- **R14/R17/R32/E2E 与 `gatePassed`**：执行面见 `.claude/agents/test-engineer.md`；
  说明权威见 `mechanical-gates.md` §8.3、§8.6。
- **`gatePassed ≠ true` 不得推进下一批次或宣告完成**；豁免须双要素（`gated-artifacts.json`
  声明 + `process.md` 用户确认行），仅一项不生效。
- **R34 执行证明**：`test-results/**` 机读产物须带门禁签发的 `execProof`。**禁止手工编辑这些产物**
  （含「只改一个 `gatePassed`」「补个缺失字段」「复用上一批次产物」）——签名覆盖除 `execProof` 外
  全部字段，改动会被识破为 `exec-proof-signature-mismatch`，与伪造测试结论同级。须**在代理 Shell
  通道内**重跑对应 `*-run.mjs` 以取得新证明。例外：`test-results/recon/*.json`（R17 对账证据）仍由
  测试工程师手写，但须是实际查验后的记录。
- **R38 工具不可用 ≠ 检查未通过**：产物含 `toolUnavailable: true` 时，失败源于工具/依赖/网络/代理/
  证书，**不是**代码质量问题。不得编造违规项或缺陷来「解释」它；须回报项目经理走「标 `blocking` +
  `AskUserQuestion` 请用户决策」路径。说明权威见 `mechanical-gates.md` §8.8。
- **E2E 测试树的期望角色是 test-engineer**（R23，`e2e/` 全域）；`playwright.config.ts` 在项目根、属受门禁产品源码，
  期望角色为 development-engineer，TE 写它会被 R5/R21 直接 deny（见 `test-engineer.md`）。
- **删除即伪造**：`test-results/**` 是五项硬门禁的唯一证据面，删除/搬移它等同回滚已交卷的轮次，
  Shell 通道同样拦截（F-23）。

执行权威始终是 Hook / `*-run.mjs`，文档不得单独放宽（**R12**）。
