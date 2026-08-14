---
paths:
  - "docs/**/requirement/**"
  - "docs/**/design/**"
---

# 需求 / 设计成果物编辑提醒

这些文件是门禁链（R13）的**前置判据**，也是下游全部角色的输入。Hook 校验的是「存在 +
有效 + 本轮时效」，不是「写得好不好」——但结构缺一节即判无效。

- **完整门禁链、R9、无效成果物清单**：`.claude/harness/spec/gate-chain.md`（唯一权威）。
- **模板契约**：`.claude/templates/`。章节标题即机读锚点，**不得改名或省略**。
- **R3 轮次时效**：多轮迭代下成果物恒在，判别力靠 `iterationRound`；沿用上一轮的旧成果物
  推进本轮会被判失效（F-09 / F-17）。

## 角色↔路径（R21）

| 路径 | 唯一可写角色 |
| ---- | ------------ |
| `requirement-spec.md` / `requirement-list.md` | requirements-analyst |
| `detail-design-spec.md` / `develop-task-list.md` / `gated-artifacts.json` | system-architect |
| `design-problem-list.md` | requirement-reviewer |

评审专家**不亲自修改**设计成果物——返工由架构师按问题清单执行。

## 结构硬要件

- `requirement-spec.md`：「3.4 界面与交互期望」（**R33** 输入，用户已确认的对标参照/布局/
  导航；不得以组件库默认外观代替）、「6. 隐性需求确认记录」。
- `detail-design-spec.md`：§3 目录结构（**须标注各路径是否受门禁**）、§4 生产启动与异常恢复
  （**R32** 输入）+ 业务数据存储介质（**R17** 输入）、§5 lint 命令留痕或豁免说明、§6 测试策略、
  「同构模块识别」章节（**R25**，无同构族也须写明排查依据，不得留空）。
- `develop-task-list.md`：§1 任务列表、§2 依赖、§3 分派方式分析（**须含「整体分派模式」**）。
- `design-problem-list.md`：`## 审核问题表`（12 维 + 可修复字段）、`## 需求覆盖矩阵`（全 P0）、
  `## 审核结论`（首次「通过」；返工复审须「复审通过」）——三节皆 **R18** 机读。

## 用户确认类前置

**R26** 技术选型、**R33** 界面与交互期望须**真实**使用 `AskUserQuestion`，并由项目经理在
`process.md` `## 用户确认记录` 留机读行。Hook 只验确认行存在（`mechanical-gates.md` §8.7
边界 1）——写了确认行却没真问，等同伪造用户意志。

`gated-artifacts.json` 的 `{gate}Applicability: "n/a"` 只是双要素豁免的**第一**要素；
仅声明**实际不适用**的字段，其余不得写入（否则视为无理由弱化门禁，**R12**）。
