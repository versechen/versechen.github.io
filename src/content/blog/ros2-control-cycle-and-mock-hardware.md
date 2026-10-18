---
title: "ros2_control 控制周期 命令回映与更新频率"
description: "手算 GenericSystem 的三个周期，说明 read、update、write 的先后关系，并比较 Manager、控制器频率与 RRBot 的缓慢响应。"
pubDate: "2026-10-18"
tags: ["ROS 2", "ros2_control", "控制周期"]
category: "机器人"
series: "ROS 2 与机器人控制"
seriesOrder: 7
draft: false
heroImage: '../../assets/images/cover-ros2-08.svg'
---

本篇属于 **ROS 2 与机器人控制** 系列，正文第 6 篇。[专题目录](/blog/ros2-series-guide/) · [上一篇](/blog/ros2-pluginlib-and-plugin-lifecycle/) · [下一篇](/blog/ros2-rrbot-docker-and-motion-check/)

“命令已发出”“控制器已收到”“命令接口已改变”“硬件状态已改变”是不同事件。把它们放到具体周期中，才能解释为什么广播器读到的状态还没变化，以及为什么不能从 `write()` 这个名字推断模拟硬件的行为。

本篇先分析同步控制循环，再手算 GenericSystem 的三个周期，最后比较 RRBot 的模拟响应。

## 一个周期按什么顺序执行

主程序中的控制线程按顺序调用：

```cpp
cm->read(...);
cm->update(...);
cm->write(...);
```

对应含义是：

```text
read    硬件驱动更新状态接口
  ↓
update  到期且激活的控制器读取状态并写命令接口
  ↓
write   硬件驱动使用命令数据
```

这是正常同步路径的调用顺序。硬件可以配置较低读写频率，控制器也可以配置较低更新频率；异步组件还有自己的执行安排。因此“Manager 每轮调用 read”不等于每个硬件在这一轮都完成了一次物理通信。

控制器的消息回调由 Executor 处理，通常把目标交给周期更新路径使用。消息刚好在周期前后到达，会影响哪个周期第一次使用新目标。仅凭发布时刻不能保证严格的同周期生效。

## 三个容易混淆的量

| 名称 | 谁产生 | 谁使用 |
| --- | --- | --- |
| 应用目标 | 命令发布节点或规划器 | 控制器 |
| 命令接口值 | 控制器更新逻辑 | 硬件驱动 |
| 状态接口值 | 硬件读取或模拟逻辑 | 控制器、广播器 |

位置转发控制器可能直接把收到的目标写入位置命令接口。轨迹控制器则可能插值后生成每轮命令，其他控制器也可能输出速度或力矩。因此目标值不总等于本周期命令值。

## GenericSystem 为什么在 read 中回映

本快照的 `mock_components/GenericSystem` 在 `read()` 中包含命令到状态的模拟逻辑。对于位置接口，在未启用动力学计算、未禁用传播、偏移为零且命令有限等条件下，可以简化为：

```cpp
state = command;
```

而它的 `write()` 直接返回 `OK`，本身不改变这些值。分别见 [GenericSystem 的 read][generic-read] 和 [write 定义][generic-write]。

这不是设备通信规则，只是这个 mock 的实现选择。真实驱动的 `read()` 通常解析设备反馈，`write()` 通常编码并发送控制命令；有些驱动也会使用其他线程维护通信。

## 手算三个周期

做以下明确假设：命令和状态初值均为 0；位置命令回映开启；没有偏移或动力学；控制器每轮直接写入表中给定的新目标；没有限位或其他修改。

| 周期 | 本轮控制器目标 | read 后状态 | update 后命令 | write 后状态 |
| --- | --- | --- | --- | --- |
| 1 | 0.2 | 0.0 | 0.2 | 0.0 |
| 2 | 0.4 | 0.2 | 0.4 | 0.2 |
| 3 | -0.1 | 0.4 | -0.1 | 0.4 |

第一轮 `read()` 执行时，命令仍为旧值 0；之后 `update()` 才写入 0.2。`write()` 不回映，因此这一轮结束时状态仍为 0。第二轮 `read()` 才把上一轮的 0.2 变成状态。

第三轮结束后的状态是 0.4，若下一轮开始且没有其他变化，第四轮 `read()` 才让状态变成 -0.1。

这里的“下一周期”严格指上述同步顺序和 mock 条件。不是说所有真实电机都有固定的一周期延迟，也不是说所有控制器都只有这些步骤。

在仓库根目录可以执行下面的无 ROS 算术模型，核对表格：

```bash
python3 - <<'PY'
state = command = 0.0
for cycle, target in enumerate([0.2, 0.4, -0.1], start=1):
    state = command       # mock read
    command = target      # controller update
    # mock write does not change state
    print(cycle, target, state, command, state)
PY
```

它只验证该组假设下的周期推演。想验证仓库真实实现，应在 GenericSystem 的 `read()` 和控制器更新处观察同名接口，并记录周期序号；不要拿 RRBot 的另一套硬件实现直接作证。

## Manager 和控制器频率有什么关系

先看可整除的例子：Manager 为 100 Hz，某个同步控制器为 50 Hz，硬件读写也按 100 Hz 运行。忽略抖动，以第一次控制器更新为相对零点：

| 相对时间 | 硬件 read | 这个控制器 update | 硬件 write |
| --- | --- | --- | --- |
| 0 ms | 执行 | 执行 | 执行 |
| 10 ms | 执行 | 跳过 | 执行 |
| 20 ms | 执行 | 执行 | 执行 |
| 30 ms | 执行 | 跳过 | 执行 |
| 40 ms | 执行 | 执行 | 执行 |

控制器跳过时，命令一般保持上一次写入的值。硬件并不因此停止执行，其他到期的控制器或广播器也仍可更新。

控制器获得的 `period` 应对应其更新间隔；不要假设永远等于 Manager 的 10 ms。首轮和存在抖动时还需看实际实现。

本快照配置阶段会处理高于 Manager 的请求频率，并对不可整除频率做可达频率归一化；运行阶段依据实际经过时间决定是否更新。见 [频率配置][rate-config] 与 [更新判断][rate-runtime]。不要把配置的数值直接当作已实现的测量结果，也不要把同步结论原封不动套到异步控制器。

## RRBot 的 read 是逐步逼近

本机 RRBot 使用的是 `ros2_control_demo_example_1/RRBotSystemPositionOnlyHardware`，不是 GenericSystem。当前示例的读取逻辑可概括为：

```text
新状态 = 旧状态 + (命令 - 旧状态) / slowdown
```

默认 `slowdown=100`，即每次读取消除剩余误差的 1%。若目标为 0.5，起点为 0，从命令生效后的第一次 read 开始：

```text
第 1 次 read：0.005
第 2 次 read：0.00995
第 3 次 read：0.0148505
```

误差在 n 次 read 后约为 `初始误差 × 0.99^n`。示例 Manager 为 10 Hz 时，0.5 的初始误差缩小到 0.02 附近需要约 321 次读取，也就是约 32 秒，另加命令接收等时间。这解释了检查脚本为什么默认等待 90 秒。

轨迹点里的 `time_from_start=2s` 表示轨迹期望时刻，不保证这个慢响应模拟硬件两秒内跟上目标。最终到达与按时跟踪必须分别检验。

## 复习时怎样记录一个值

遇到“这个值为什么没变”，按下面顺序记录：

1. 它是应用目标、命令接口还是状态接口？
2. 哪个对象、哪个方法负责写？
3. 哪个对象、哪个方法负责读？
4. 两次操作发生在同一线程还是不同线程？
5. 本周期先读后写，还是先写后读？
6. 是否被低频更新、异步执行、限位或模拟模型改变？

过关标准是能独立写出三个周期的数值表，并解释“发布频率、控制器频率、Manager 频率、硬件读写频率”为什么不是同一个数。

## 源码入口

- [控制循环主程序][main-source]。
- [GenericSystem 的 read][generic-read]。
- [GenericSystem 的 write][generic-write]。
- [控制器更新频率配置][rate-config]。
- [控制器更新时机判断][rate-runtime]。
- [RRBot 示例硬件][rrbot-source]。

[main-source]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/ros2_control_node.cpp
[generic-read]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/hardware_interface/src/mock_components/generic_system.cpp#L343
[generic-write]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/hardware_interface/include/mock_components/generic_system.hpp#L64
[rate-config]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_interface/src/controller_interface_base.cpp#L203
[rate-runtime]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L3436
[rrbot-source]: https://github.com/ros-controls/ros2_control_demos/blob/jazzy/example_1/hardware/rrbot.cpp
