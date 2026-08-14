---
paths:
  - "CLAUDE.md"
  - ".claude/rules/**/*.md"
  - ".claude/settings.json"
  - ".claude/settings.local.json"
  - ".claude/harness.config.json"
  - ".claude/hooks/**"
  - ".claude/scripts/**"
  - ".claude/agents/*.md"
  - ".claude/harness/spec/**/*.md"
  - "docs/**/design/gated-artifacts.json"
---

# 门禁自治资产：任何代理都不得写（R29）

你正在查看的路径属**门禁自身**——判据本体、机读证据运行器、Hook 注册表、角色强制约束、
规约权威文本。它们**不由任何角色维护**（含 development-engineer，尽管 `CLAUDE.md` §5.1
把工程化基建授权给了 DE）。

**为什么锁到这一层**：锁配置而不锁代码等于给 R12 留后门。改写 `lint-run.mjs` 让它恒写
`gatePassed: true`，产物随后会被**真实**私钥签名、R34 验签通过，stop 门禁收下的是一份
「合法签名背书的假结果」。

## 分级（裁决同为 deny，解法不同）

| 类别 | 典型路径 | 解法 |
| ---- | -------- | ---- |
| `gate-config` | `CLAUDE.md`、`.claude/settings.json`、`.claude/harness.config.json`、`.claude/harness/spec/**`、`.claude/rules/**` | 呈完整 diff + 理由，由**用户本人**落盘 |
| `gate-code` | `.claude/hooks/**`、`.claude/scripts/**` 的运行器与自测、`.claude/agents/*.md` | 同上 |
| `runtime-marker` | `.claude/hooks/.root-conversation-id.json`、`.dispatched-roles.json`、`.exec-proof-ledger.json`、`.gate-exception-ledger.json`、`.exec-proof-pending/` | 只由 Hook 进程自写；代理写入＝自签身份/自签证明 |
| `approval-marker` | `.claude/hooks/.toolchain-install-approved.json` | 只由用户本人创建；代理写入＝自签授权 |

`docs/**/design/gated-artifacts.json` 是门禁强度旋钮，期望角色为 **system-architect**，
但只能收紧：`extra*` 收紧字段会被合并，放松型字段不会（见 `mechanical-gates.md` §8.5）。

## 正确通道

1. 把拟改内容以**完整 diff + 变更理由**呈现给用户；
2. 由**用户本人**落盘；
3. 若属**加强**方向（R12 允许），同样须用户落盘，并在 `.claude/harness/spec/**` 留痕。

**改不动不是能力缺失，是刻意把「调整门禁自身」保留给人类。** 不得改用 Shell 通道绕道
（R28 同源拦截），不得以「临时放宽」「便于通过」为由修改。

## 修改方向铁律（R12）

只允许**新增或加强**约束。发现「文档声明强于实现」⇒ **补实现**；发现「实现严于声明到
真实项目不可达」也是缺陷，但修正方向属放松——**代理不得自行改回**，须呈证据、经用户明确
确认，并在 `.claude/harness/spec/**` 留痕（见 `mechanical-gates.md` §8.5）。
