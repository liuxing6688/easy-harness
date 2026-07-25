# tests/scenarios — 场景级门禁回归（按场景拆分）

入口：`node .cursor/scripts/gate-scenarios.mjs`（`--verbose` 可选）

| 文件 | 覆盖 |
| ---- | ---- |
| `_harness.mjs` | fixture / spawn Hook / `check()` |
| `greenfield.mjs` | G1–G11e |
| `feature.mjs` | F1–F2 |
| `hotfix.mjs` | H1–H6 |
| `lint-gate.mjs` | L1–L4 |
| `static-scan-gate.mjs` | S1–S5 |
| `adversarial.mjs` | A1–A10 |
| `r5-conversation.mjs` | C1–C11 |
| `finding1.mjs` | B1 出厂模板 |

新增场景：新建 `*.mjs` 导出函数，在 `run-all.mjs` 注册调用。
