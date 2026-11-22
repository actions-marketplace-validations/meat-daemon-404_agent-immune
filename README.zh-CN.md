# agent-immune (`dsh-immune-system` v3.0.0)

[![npm version](https://img.shields.io/npm/v/dsh-immune-system?color=00b894&logo=npm)](https://www.npmjs.com/package/dsh-immune-system)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://github.com/meat-daemon-404/agent-immune)
[![Tests](https://img.shields.io/badge/Tests-40%2F40_Passing-2ea44f)](https://github.com/meat-daemon-404/agent-immune/tree/main/tests)

[English](README.md) | [简体中文](README.zh-CN.md)

> **面向 AI 编程智能体的自进化踩坑免疫系统与执行前爆炸半径拦截器** —— 自动捕获每一次 `失败 → 修复` 的工具调用回合，提炼为可复用的**数字抗体（Antibody）**存入本地 `SQLite + FTS5`，在危险命令执行前进行 0–100 爆炸半径确定性评分与安全改写（`immune guard`），编译可随 Git 提交的 `.immune/vaccine.lock.json` 项目疫苗锁文件（`immune vaccinate`），并支持跨 7 大智能体平台的群体记忆联邦合并（`immune federate`）。

## 支持的 7 大智能体宿主平台

| 平台 | 集成方式 | 一键配置命令 |
| :--- | :--- | :--- |
| **Claude Code** | `PreToolUse` / `PostToolUse` 钩子 + MCP 服务 | `npx dsh-immune-system setup --target claude` |
| **Codex CLI** | MCP 服务 + 执行前工具守卫 | `npx dsh-immune-system setup --target codex` |
| **Cursor** | `.cursor/mcp.json` + `.cursor/rules/immune.mdc` | `npx dsh-immune-system setup --target cursor` |
| **ZCode** | 原生插件 + MCP 桥接 | `npx dsh-immune-system setup --target zcode` |
| **DeepSeek Harness (DSH)** | 原生 Cordis 插件（`src/index.ts`）+ 上下文抗体自动注入 | `npx dsh-immune-system setup --target dsh` |
| **Gemini CLI** | `.gemini/settings.json` MCP 服务 | `npx dsh-immune-system setup --target gemini` |
| **Windsurf** | Cascade MCP 配置 + 工作区疫苗锁同步 | `npx dsh-immune-system setup --target windsurf` |

## v3.0.0 三大核心特性

1. **执行前爆炸半径守卫与自动无损改写（`src/core/guard.ts` · `immune guard`）**
   - 在 Shell 或高危工具真正落盘执行**之前**进行同步拦截，内置 7 条高危基线策略（`BUILTIN_GUARD_POLICIES`，涵盖 `rm -rf /`、向主分支 `git push --force`、无备份 `DROP TABLE`、递归 `chmod 777`、硬编码密钥提交等）并融合本地高置信度（`confidence >= 0.72`）抗体。
   - 输出 **0–100 爆炸半径风险评分**（`allow` / `warn` / `rewrite` / `block`），并自动给出或执行安全改写命令（例如将 `git push --force` 自动改写为 `git push --force-with-lease`）。
2. **项目级 DNA 疫苗锁文件（`src/core/vaccine.ts` · `immune vaccinate`）**
   - 将当前仓库验证通过的高置信度抗体编译为带 SHA-256 完整性签名的 `.immune/vaccine.lock.json` 锁文件，直接纳入 Git 版本控制。
   - 团队成员或 CI 智能体克隆仓库后运行 `immune vaccinate --apply`，首轮对话即可继承项目全部历史踩坑记忆。
3. **跨平台群体免疫联邦（`src/core/federate.ts` · `immune federate`）**
   - 自动扫描本机全部智能体的 SQLite 免疫库，基于置信度加权共识（`federateSwarmRules`）跨库去重合并，并生成暗色拓扑大盘 SVG（`renderFederationSvg`）。

## 快速开始

```bash
# 全局安装或直接通过 npx 运行
npm install -g dsh-immune-system

# 1. 自动探测本机已安装的智能体并注入钩子与 MCP 服务
immune setup

# 2. 对工具调用或命令执行 Pre-Flight 爆炸半径评估
immune guard --tool bash --command "git push --force origin main" --json

# 3. 导出或应用可提交至 Git 的项目 DNA 疫苗锁文件
immune vaccinate --export .immune/vaccine.lock.json
immune vaccinate --apply .immune/vaccine.lock.json

# 4. 联邦合并本机所有智能体免疫库并导出 SVG 拓扑图
immune federate --svg .immune/federation.svg
```

## 验证与构建

```bash
npm test          # 运行全部 40 项 Vitest 单元与集成测试（7 个测试套件）
npm run typecheck # TypeScript 严格类型检查
npm run build     # 构建 ESM/CJS 产物与 CLI 至 dist/
```

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
