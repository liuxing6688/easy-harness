# tests/selftest — 门禁单元自测（按规则拆分）

入口：`node .trae/scripts/gate-selftest.mjs`

| 文件 | 覆盖 |
| ---- | ---- |
| `_harness.mjs` | fixture 目录 / 快照还原 / `test()` |
| `_fixtures.mjs` | 跨套件共享工厂与常量 |
| `r*.mjs` / `b1-*.mjs` | 对应规则用例 |

新增回归：复制相近规则文件，在 `run-all.mjs` 增加一行 `import`；跨套件常量放入 `_fixtures.mjs`。
