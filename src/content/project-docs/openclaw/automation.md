---
title: 自动化
description: Cron、Heartbeat、Webhook 与 Hooks
order: 4
section: 概念
---

# 自动化

除了即时对话，OpenClaw 还支持定时与事件驱动任务：

| 机制 | 适用场景 |
| --- | --- |
| Cron | 固定时间执行的计划任务 |
| Heartbeat | 周期性健康检查与轻量轮询 |
| Webhook | 外部系统推送触发 |
| Hooks | 生命周期扩展点 |

选择原则：需要精确时刻用 Cron；需要低频探活用 Heartbeat；需要外部事件驱动用 Webhook。
