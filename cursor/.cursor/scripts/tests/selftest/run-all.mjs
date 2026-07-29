/**
 * 按规则加载全部单元自测套件并汇总结果。
 *
 * 本文件仅做 side-effect import 注册；真正断言在各 `r*.mjs` / `b1-*.mjs`。
 * 新增套件：在下方增加一行 `import './xxx.mjs'`，并更新 `./README.md`。
 * 入口：`node .cursor/scripts/gate-selftest.mjs`
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
import './r28-r31-hardening.mjs';

finishSelftest();
