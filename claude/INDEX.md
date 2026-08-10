# Claude Code Harness Engineering - 文档索引

本目录包含从 Cursor 完整移植到 Claude Code 的 Harness Engineering 规约。

---

## 📚 快速导航

### 👉 新用户从这里开始

1. **[QUICKSTART.md](QUICKSTART.md)** - 5分钟快速开始
2. **[CLAUDE.md](CLAUDE.md)** - 完整规约说明
3. 运行验证: `node test-hooks-lib.mjs`

### 🔧 维护者文档

- **[MIGRATION_SUMMARY.md](migration/docs/MIGRATION_SUMMARY.md)** - 移植执行总结
- **[FINAL_MIGRATION_REPORT.md](migration/docs/FINAL_MIGRATION_REPORT.md)** - 完整移植报告
- **[CURSOR_TO_CLAUDE_GAP_ANALYSIS.md](migration/docs/CURSOR_TO_CLAUDE_GAP_ANALYSIS.md)** - 差距分析

---

## ✅ 移植状态

**总体进度**: 100% 完成
**核心功能**: ✅ 100% 可用
**测试通过率**: 100% (422/422)

---

## 🚀 立即使用

```bash
# 1. 验证
cd claude && node test-hooks-lib.mjs

# 2. 复制到项目
cp -r .claude /path/to/your-project/

# 3. 启动
claude
```

详见 **[QUICKSTART.md](QUICKSTART.md)**

---

**版本**: v1.0 | **更新**: 2026-08-06 | **状态**: 生产就绪 ✅
