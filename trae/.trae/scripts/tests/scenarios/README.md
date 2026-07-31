# tests/scenarios — 场景级门禁回归（按场景拆分）

入口：`node .trae/scripts/gate-scenarios.mjs`（`--verbose` 可选）

| 文件 | 覆盖 |
| ---- | ---- |
| `_harness.mjs` | fixture / spawn Hook / `check()` |
| `greenfield.mjs` | G1–G11e |
| `feature.mjs` | F1–F2 |
| `hotfix.mjs` | H1–H6 |
| `lint-gate.mjs` | L1–L4 |
| `static-scan-gate.mjs` | S1–S5 |
| `adversarial.mjs` | A1–A10 |
| `r5-conversation.mjs` | C1–C17 |
| `te-smoke.mjs` | SM0–SM6 TE 替代启动冒烟门禁（R22） |
| `startup-smoke.mjs` | SS0–SS7 生产启动冒烟正向证据（R32）与界面期望确认（R33） |
| `hardening.mjs` | 审核加固项 R28–R31 与 R5·R6 加强（端到端） |
| `audit-fixes.mjs` | AF1–AF19 审核加固项 R34 执行证明与产物新鲜度 / R35 阻塞释放与出处校验 / R36 修复通道作用域 / R37 增量档 / R38 工具不可用（端到端） |
| `finding1.mjs` | B1 出厂模板 |

新增场景：新建 `*.mjs` 导出函数，在 `run-all.mjs` 注册调用。

> **followup 文案的指向本身就是判据。** R38 与 R34 的价值不在「拦住」（原来也拦得住），
> 而在**拦住之后把人指向正确的方向**——把「工具装不上」说成「请整改重复代码」会让开发工程师
> 去修一个不存在的缺陷。故 `audit-fixes.mjs` 用 `checkFollowupText` 断言文案的
> must / mustNot 关键词，而不只断言 `outcome === 'followup'`。
