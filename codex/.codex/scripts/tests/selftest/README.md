# tests/selftest — 门禁单元自测（按规则拆分）

入口：`node .codex/scripts/gate-selftest.mjs`

| 文件 | 覆盖 |
| ---- | ---- |
| `_harness.mjs` | fixture 目录 / 快照还原 / `test()` |
| `_fixtures.mjs` | 跨套件共享工厂与常量 |
| `r*.mjs` / `b1-*.mjs` | 对应规则用例 |
| `templates-vs-gates.mjs` | **出厂模板 ↔ 出厂门禁一致性**：加载 `.codex/templates/` 真实文件，断言被 Hook 解析的章节能定位、最小合规填充后判据真的通过 |
| `gated-artifacts-config.mjs` | R29 加强：`docs/**/design/gated-artifacts.json` 的角色门禁（仅 SA 可写，Write/Shell 同判） |
| `codex-adapter.mjs` | Codex 生命周期 Hook 协议适配：apply_patch / Agent / Bash 输入与 deny / Stop 输出映射 |
| `r34-exec-proof.mjs` | R34 执行证明：合法签发+落签必须放行（防不可达）；缺字段/未签发/未知 nonce/kind 错配/私钥未消费/签名失配六类形态必须被识破 |
| `r35-blocking-evidence.mjs` | R35 阻塞释放证据：出厂模板与占位不算实质阻塞原因；机器起源单独放行；fail-open 落盘的阻塞须天然满足本判据 |
| `r36-gate-exception.mjs` | R36 判定期异常：各通道裁决（deny/ask/followup）、write 通道的 process.md 修复例外、文案须指向用户级逃生开关 |
| `r37-single-task.mjs` | R37 增量档：增量范围四维机读、schema 变更硬禁用、基线设计前置、折叠通道仍要求 R14/R17、R26 豁免不外溢 |
| `r38-tool-unavailable.mjs` | R38 工具不可用：五类信号识别、真实质量失败不得误判、工具不可用仍不放行但 reason/文案不同 |

> **`_harness.mjs` 的 `writeLintResult` / `writeStaticScanResult` / `writeStartupSmokeResult`
> 默认按 R34 落真实签名**（走 `issueExecutionProof` + `attachExecutionProof`，见
> `../exec-proof-fixture.mjs`）。这是刻意的：若给夹具开一个「测试模式跳过验签」的后门，
> 回归测的就是「验签被关掉时的行为」，与 `templates-vs-gates.mjs` 抓过的漂移同类。
> 需要构造未签名产物时传 `{ sign: false }`。

新增回归：复制相近规则文件，在 `run-all.mjs` 增加一行 `import`；跨套件常量放入 `_fixtures.mjs`。

> **只导入本套件实际使用的符号。** 历史上 19 个套件各自复制了同一份 84 名 `_harness.mjs` +
> 38 名 `_fixtures.mjs` 的巨型 import 清单（69 行 × 17 处字节完全相同），却各自只用 3–18 个——
> 这一份复制粘贴独占了全仓重复代码的绝大部分，使框架自身过不了自己的 **R16** 门禁
> （9.56%，阈值 5%）。裁剪后降至 2.78%。**照抄他人的 import 块会立刻把重复率推回门禁线**；
> 顺带地，精简后的 import 列表本身就是「该套件测什么」的可读声明。

> **新增「Hook 解析某个 `## 章节`」的规则时，必须同时在 `templates-vs-gates.mjs` 的
> `PARSED_SECTIONS` 表登记。** 其余套件用的都是自拼字符串夹具，无法发现「模板标题与 Hook
> 实参漂移」这类缺陷——R19 的 `## 6. 隐性需求确认记录` 就是在 394 条回归全绿的情况下逃逸的
> （详见 `.codex/harness/spec/mechanical-gates.md` §8.5「解析层缺陷修复」）。
