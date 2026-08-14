# tests/selftest — 门禁单元自测（按规则拆分）

入口：`node .claude/scripts/gate-selftest.mjs`

| 文件 | 覆盖 |
| ---- | ---- |
| `_harness.mjs` | fixture 目录 / 快照还原 / `test()` |
| `_fixtures.mjs` | 跨套件共享工厂与常量 |
| `r*.mjs` / `b1-*.mjs` | 对应规则用例 |
| `templates-vs-gates.mjs` | **出厂模板 ↔ 出厂门禁一致性**：加载 `.claude/templates/` 真实文件，断言被 Hook 解析的章节能定位、最小合规填充后判据真的通过；**F-07 加固**：`workflow-modes.md`「迭代模式（文档路径）」表须覆盖 `LITE_WORKFLOW_MODES` + `full` 的每一个模式（缺行即 F-07 成因） |
| `gated-artifacts-config.mjs` | R29 加强：`docs/**/design/gated-artifacts.json` 的角色门禁（仅 SA 可写，Write/Shell 同判） |
| `r28-r31-hardening.mjs` | R28 Shell 写意图 / R29 自治资产四级分类 / R30 / R31；**规则层收回豁免**（`.claude/rules/**.md` 归 `gate-config`，Write 与 Shell 同判，见 `mechanical-gates.md` §8.9） |
| `r34-exec-proof.mjs` | R34 执行证明：合法签发+落签必须放行（防不可达）；缺字段/未签发/未知 nonce/kind 错配/私钥未消费/签名失配六类形态必须被识破 |
| `r35-blocking-evidence.mjs` | R35 阻塞释放证据：出厂模板与占位不算实质阻塞原因；机器起源单独放行；fail-open 落盘的阻塞须天然满足本判据 |
| `r36-gate-exception.mjs` | R36 判定期异常：各通道裁决（deny/ask/followup）、write 通道的 process.md 修复例外、文案须指向用户级逃生开关 |
| `r37-single-task.mjs` | R37 增量档：增量范围**五维**机读、**破坏性变更（需迁移/破坏兼容）硬禁用**与兼容路径的兼容性回归对价（**F-08**）、基线设计前置、折叠通道仍要求 R14/R17、R26 豁免不外溢 |
| `r38-tool-unavailable.mjs` | R38 工具不可用：五类信号识别、真实质量失败不得误判、工具不可用仍不放行但 reason/文案不同 |
| `f09-f11-f17-round.mjs` | 轮次时效性：F-11 同名/多轮章节聚合、F-17 模式确认行不跨轮背书、F-09 审核结论须标本轮轮次、**F-09 增量范围 ↔ `requirement-list.md` 本轮编号交叉校验**（判据本体；派发分支的挂载点在 `r37-single-task.mjs`） |
| `blocking-failopen.mjs` | 阻塞判定与 fail-open 留痕；**F-22 台账 → 表格行反向对账**（删整行 / 改摘要 / 无台账条目不死锁）；**F-25 闭环**（门禁自己写的事件行须能被自己的判据读回并释放阻塞、连续两次 fail-open 不得被阻塞原因正文劫持） |
| `r30-table-escape.mjs` | **F-10 / R30** 转义竖线 `\|`：切分器还原、列不位移、P0 提取 / 分派计划 / 通用表格解析三条下游判据；**两份 `splitTableRow`（`core.mjs` ↔ `e2e-run-lib.mjs`）口径一致性**（交叉生成语料逐字比对，把「改一处须同步另一处」从注释义务变成机械可捕获） |
| `f05-outputdir.mjs` | **F-05** `playwright.config.*` 的 `outputDir` 机械兜底：未声明 / 指向门禁产物目录的祖先或自身 / 非字面量三类拒绝，合规隔离目录与项目根之外放行，注释里的 `outputDir` 不得被当成声明，出厂配置须自证通过 |

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
> （详见 `.claude/harness/spec/mechanical-gates.md` §8.5「解析层缺陷修复」）。
