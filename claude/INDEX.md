# Claude Code Harness Engineering - 文档索引

本目录是 Harness Engineering 规约的 **Claude Code 适配（v2.0 技术强制版）**，由 Cursor 版完整移植而来。

---

## 📚 快速导航

### 👉 新用户从这里开始

1. **[QUICKSTART_15MIN.md](QUICKSTART_15MIN.md)** - 15 分钟从零上手（推荐入口）
2. **[QUICKSTART.md](QUICKSTART.md)** - 快速开始与接入项目
3. **[CLAUDE.md](CLAUDE.md)** - 完整规约（薄宪章 + 权威索引）
4. 运行验证：`node .claude/scripts/gate-selftest.mjs`

### 📖 日常参考

- **[REFERENCE_CARD.md](REFERENCE_CARD.md)** - 一页纸速查卡
- **[SCENARIOS_HANDBOOK.md](SCENARIOS_HANDBOOK.md)** - 10 个实战场景
- **[README.md](README.md)** - 框架全景与 Hook 工作原理

### 🔧 维护者文档

- **[.claude/rules/](.claude/rules/)** - 规则层（路径触发的上下文提醒；细则见 `mechanical-gates.md` §8.9）
- **[.claude/harness/spec/](.claude/harness/spec/)** - 说明权威（公式、豁免表、能力边界）
- **[.claude/hooks/lib/README.md](.claude/hooks/lib/README.md)** - 判据按域拆分说明
- **[.claude/scripts/tests/selftest/README.md](.claude/scripts/tests/selftest/README.md)** - 自测套件覆盖表

---

## ✅ 当前状态

| 项 | 值 |
| -- | -- |
| Hook 注册权威源 | `.claude/settings.json`（7 个脚本：6 门禁 + 1 会话初始化） |
| 单元自测 | `gate-selftest.mjs` → **538 passed, 0 failed** |
| 场景回归 | `gate-scenarios.mjs` → **180 passed, 0 failed** |
| 技术强制 | ✅ 与 Cursor 版对等 |

> **⚠️ 生效的是 `-enhanced` 变体**：`gate-dev-workflow-enhanced.mjs` 与
> `session-init-enhanced.mjs` 才是 `settings.json` 里注册的那份；同名非 enhanced
> 文件仍在盘上但**不生效**，改门禁行为务必改 enhanced 那份。

---

## 🚀 立即使用

```bash
# 1. 验证（须以本目录为 cwd）
node .claude/scripts/gate-selftest.mjs
node .claude/scripts/gate-scenarios.mjs

# 2. 复制到你的项目
cp -r .claude /path/to/your-project/
cp CLAUDE.md /path/to/your-project/

# 3. 启动
claude
```

详见 **[QUICKSTART_15MIN.md](QUICKSTART_15MIN.md)**。

---

**版本**: v2.0（技术强制版） | **更新**: 2026-08-13 | **状态**: 生产就绪 ✅
