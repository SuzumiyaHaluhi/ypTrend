# ypTrend

一个面向 **AI 大模型 / AI 编程方向** 的轻量热点监控工具。  
通过多源采集、AI 判定、统一信号门槛与实时推送，帮助用户尽快发现高价值趋势并自动通知。

## 项目目标

- 支持手动配置监控关键词
- 从多信息源自动采集候选热点，避免单一来源偏差
- 使用 AI 判断相关性与可信度，降低误报
- 命中后通过飞书第一时间通知
- Web 端可实时查看热点流与通知流（SSE 推送，无需刷新）

## 当前状态（2026-04-16）

- Web MVP 主链路已稳定可用
- 已完成：采集 -> 去重 -> AI 判定 -> 门槛拦截 -> 飞书通知 -> SSE 推送 -> 前端实时展示
- 已进入“参数精调 + 体验优化 + Agent Skill 封装准备”阶段

## 技术栈

- 前端：React + Vite + Tailwind CSS v4 + shadcn + Aceternity UI
- 后端：Node.js + Express
- 存储：SQLite（better-sqlite3）
- 调度：node-cron
- AI：OpenRouter（无 Key 时支持启发式降级）
- 通知：飞书 Webhook（首行关键词校验 `trend`）
- 实时：SSE（`/api/stream`）

## 核心能力

### 1) 多源采集

- Twitter（`twitterapi.io`）
- Web（DuckDuckGo + Bing Web RSS + Bing News RSS）
- RSS（Google News RSS，支持多 locale）

### 2) 评分与门槛策略

- Twitter 互动分：
  - `engagementScore = 1.5*likes + 2*retweets + 2*quotes + replies + views/100`
  - 严格原创过滤：reply / quote / retweet 不入候选
- Web/RSS 信号分：
  - `signalScore = sourceAuthority + recency + corroboration + contentQuality + aiConfidenceBonus`
- 统一通知硬门槛：
  - Twitter：`engagement_score >= twitterQuality.notifyMinEngagementScore`（默认 2000）
  - Web/RSS：`signalTier = high`（阈值默认 70）
  - 且必须满足 AI 判定相关 / 可信 / 应通知

### 3) 可靠性机制

- URL 归一化 + `unique_hash` 去重
- 7 天新鲜度窗口过滤
- 低可信候选可要求跨源佐证（最小独立来源数可配置）
- 失败兜底与可复跑验收脚本

## 项目结构

```text
ypTrend/
  docs/                # 需求、技术方案、开发进展
  server/              # 后端服务（API、采集、评分、通知、SSE）
  web/                 # 前端应用（热点流、通知流、参数配置）
```

## 快速开始

### 1) 安装依赖

```bash
npm --prefix server install
npm --prefix web install
```

### 2) 配置环境变量

在 `server` 下根据示例文件配置：

```bash
cp server/.env.example server/.env
```

关键配置建议（示例）：

- `OPENROUTER_API_KEY`
- `TWITTERAPI_IO_KEY`
- `FEISHU_WEBHOOK_URL`
- `FEISHU_KEYWORD=trend`
- `FRESHNESS_WINDOW_DAYS=7`
- `SEARCH_LOCALES=zh-CN,en-US`

### 3) 启动开发环境

```bash
npm --prefix server run dev
npm --prefix web run dev
```

默认情况下：

- 后端运行在 `http://localhost:3000`（以实际配置为准）
- 前端运行在 Vite 默认端口（通常 `5173`）

## 常用接口

- `GET /api/health`
- `GET/POST/PATCH/DELETE /api/keywords`
- `GET /api/hot-items`
- `GET /api/notifications`
- `GET/PUT /api/settings`
- `POST /api/run-now`
- `GET /api/stream`（SSE）

## 测试与验收

```bash
# 后端单测
npm --prefix server test

# P0 验收（链路）
npm --prefix server run accept:p0-1

# P0/P2 验收（持久化）
npm --prefix server run accept:p0-2

# 前端检查
npm --prefix web run lint
npm --prefix web run build
```

## 数据与配置说明

- 核心表：`monitors`、`hot_items`、`ai_evaluations`、`notifications`、`settings`
- `hot_items` 已包含结构化质量字段（`engagement_score`、`signal_score`、`signal_tier` 等）
- 服务启动时会执行自动补列迁移，兼容旧 SQLite 数据库
- 系统参数页支持在线调节 Twitter 推送阈值与 Web/RSS 高信号阈值

## 路线图

1. 增强阈值组合下的自动化回归用例
2. 补充运维向文档（参数调优与故障排查）
3. 在 Web MVP 稳定基础上封装 Agent Skill

## 参考文档

- `docs/需求说明.md`
- `docs/技术方案.md`
- `docs/开发进展.md`

