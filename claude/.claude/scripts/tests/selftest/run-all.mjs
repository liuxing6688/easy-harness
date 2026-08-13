/**
 * 按规则加载全部单元自测套件并汇总结果。
 *
 * 本文件仅做 side-effect import 注册；真正断言在各 `r*.mjs` / `b1-*.mjs`。
 * 新增套件：在下方增加一行 `import './xxx.mjs'`，并更新 `./README.md`。
 * 入口：`node .claude/scripts/gate-selftest.mjs`
 */
import { finishSelftest } from './_harness.mjs';

import './r6-paths.mjs';
import './b1-taskpack.mjs';
import './r3-artifacts.mjs';
import './r9-hotfix-design.mjs';
import './r10-cancel.mjs';
import './r11-hotfix-fold.mjs';
import './r20-lite-mode.mjs';
import './unresolved-issues.mjs';
import './r18-design-review.mjs';
import './r9-soft-reminder.mjs';
import './blocking-failopen.mjs';
import './r13-dispatch.mjs';
import './r13-qe.mjs';
import './r14-api-test.mjs';
import './r17-storage-recon.mjs';
import './r15-lint.mjs';
import './r16-static-scan.mjs';
import './r5-identity.mjs';
import './te-smoke.mjs';
import './r32-startup-smoke.mjs';
import './r33-ui-expectation.mjs';
import './r28-r31-hardening.mjs';
// 2026-07-30 规约审核加固：R34 执行证明 / R35 阻塞释放证据 / R36 判定期异常 /
// R37 single-task 增量档 / R38 工具不可用
import './r34-exec-proof.mjs';
import './r35-blocking-evidence.mjs';
import './r36-gate-exception.mjs';
import './r37-single-task.mjs';
import './r38-tool-unavailable.mjs';
// 2026-08-11 v2 评审：F-10 表格转义竖线击穿全部表格判据；
// F-11 同名/多轮章节只取第一节；F-17 轻量模式确认无时效性；F-09 审核结论跨轮沿用
import './r30-table-escape.mjs';
import './f09-f11-f17-round.mjs';
// F-06 覆盖率可被省参数架空；F-14 进程级故障被误导成「用例没写够」
import './f06-f14-e2e-gate.mjs';
// F-05 加固：playwright.config.* 的 outputDir 由机械层兜底（原只靠模板默认值 + 文档）
import './f05-outputdir.mjs';
import './templates-vs-gates.mjs';
import './gated-artifacts-config.mjs';

finishSelftest();
