---
title: 渠道与路由
description: 把助手接到日常聊天工具
order: 3
section: 概念
---

# 渠道与路由

OpenClaw 的产品形态是「出现在你已经在用的聊天工具里」，而不是另开一个独立 App。

## 常见渠道

- WhatsApp（Web channel）
- Telegram / Discord / Slack
- Signal / iMessage / Google Chat / Microsoft Teams
- 扩展：Matrix、BlueBubbles、Zalo 等

## 路由思路

Gateway 把入站消息路由到对应 agent，再把回复写回原渠道。群组、配对与权限策略可在渠道配置中单独调整。
