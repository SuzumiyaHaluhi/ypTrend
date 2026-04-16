# ypTrend

面向 AI 大模型 / AI 编程方向的热点监控项目。
当前提供两条可独立使用的能力链路：

1. Web 平台链路（`server + web`）
2. 自包含 Skill 链路（`skills/hot-monitor`）

## 核心能力

### Web 平台链路
- 多源采集（Twitter/Web/RSS）
- AI 判定与门槛拦截
- 飞书通知（关键词首行 `trend`）
- SSE 实时推送到前端
- 参数化阈值调优

### 自包含 Skill 链路（hot-monitor）
- 不依赖本地后端服务
- 脚本直连公开数据源/API
- 可选接入 twitterapi.io
- 生成结构化热点报告（Markdown）

## 项目结构

```text
ypTrend/
  docs/
    技术方案.md
    开发进展.md
    需求说明.md
  server/
  web/
  skills/
    hot-monitor/
      SKILL.md
      agents/openai.yaml
      references/
      scripts/
```

## 快速开始

### 1) 安装依赖

```bash
npm --prefix server install
npm --prefix web install
```

### 2) 运行 Web 平台链路

```bash
npm --prefix server run dev
npm --prefix web run dev
```

常用接口：
- `GET /api/health`
- `GET/POST/PATCH/DELETE /api/keywords`
- `POST /api/run-now`
- `GET /api/hot-items`
- `GET /api/notifications`
- `GET /api/stream`

### 3) 运行自包含 Skill 链路（hot-monitor）

```bash
python -B skills/hot-monitor/scripts/search_web.py --query "AI coding" --limit 40 --output skills/hot-monitor/output/web.json
python -B skills/hot-monitor/scripts/search_china.py --query "AI coding" --limit 40 --output skills/hot-monitor/output/china.json
python -B skills/hot-monitor/scripts/search_twitter.py --query "AI coding" --limit 40 --output skills/hot-monitor/output/twitter.json
python -B skills/hot-monitor/scripts/generate_report.py --query "AI coding" --inputs skills/hot-monitor/output/web.json skills/hot-monitor/output/china.json skills/hot-monitor/output/twitter.json --output skills/hot-monitor/output/report.md
```

说明：
- `search_twitter.py` 需要可选环境变量 `TWITTERAPI_IO_KEY`。
- 未配置 Key 时会自动跳过 Twitter 源，不会中断整体流程。

## 测试与验收

### Web 平台
```bash
npm --prefix server test
npm --prefix server run accept:p0-1
npm --prefix server run accept:p0-2
npm --prefix web run lint
npm --prefix web run build
```

### Skill
```bash
python C:/Users/Yu/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/hot-monitor
python -B skills/hot-monitor/scripts/search_web.py --help
python -B skills/hot-monitor/scripts/search_china.py --help
python -B skills/hot-monitor/scripts/search_twitter.py --help
python -B skills/hot-monitor/scripts/generate_report.py --help
```

## 版本说明
- 当前文档基线：MVP v1.6（双轨落地版）
- 已废弃旧 Skill：`skills/yptrend-hotspot-monitor`

## 参考文档
- `docs/需求说明.md`
- `docs/技术方案.md`
- `docs/开发进展.md`
