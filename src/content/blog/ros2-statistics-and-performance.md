---
title: "ros2_control 耗时统计 性能分析与优化路径"
description: "从 REGISTER_ENTITY 到变量赋值和话题发布，区分执行耗时、实际周期、抖动与设备响应，建立基于统计和 tracing 的优化方法。"
pubDate: "2026-10-18"
tags: ["ROS 2", "ros2_control", "性能优化"]
category: "机器人"
series: "ROS 2 与机器人控制"
seriesOrder: 9
draft: false
heroImage: '../../assets/images/cover-ros2-02.svg'
---

本篇属于 **ROS 2 与机器人控制** 系列，正文第 8 篇。[专题目录](/blog/ros2-series-guide/) · [上一篇](/blog/ros2-rrbot-docker-and-motion-check/)

性能分析首先需要分清：是代码执行慢、线程没有及时获得 CPU、消息传输延迟，还是设备响应慢。Manager 的执行耗时指标能回答其中一部分问题，Executor tracing 和设备侧测量则补充其他部分。

本篇从 `REGISTER_ENTITY` 的语法开始，串起变量更新、数据发布和诊断方法。

## REGISTER_ENTITY 注册的是什么

源码中有：

```cpp
const std::string cm_name = get_name();
REGISTER_ENTITY(
  hardware_interface::CM_STATISTICS_KEY,
  cm_name + ".update_time",
  &execution_time_.update_time);
```

`get_name()` 返回当前节点名；`const std::string` 保存一个不可再赋值的字符串；字符串的 `+` 用于拼接指标名称；`.` 访问结构体成员；`&` 取得该成员的地址。

`REGISTER_ENTITY` 是 `pal_statistics` 提供的宏，不是 C++ 关键字。三个参数依次是统计集合标识、指标名称和采集来源：

```text
统计集合 cm_execution_statistics
    └─ 指标 controller_manager.update_time
              ↓
       execution_time_.update_time 的地址
```

登记的是变量地址，因此后续赋值不需要重新注册。它不是在注册时复制一个固定数值，也不会因为传了地址就自动开始计时。

被采集对象必须在注册有效期间存活，移除对象时要协调注销和读取。随意注册很快销毁的局部变量，会产生失效地址。注册操作也不应随意放到实时更新路径中。见 [仓库 introspection 文档][introspection-doc]。

## 数值在哪里更新

Manager 的 `update()` 开始时保存 `steady_clock` 时间，结束前计算时间差并赋值：

```cpp
execution_time_.update_time =
  std::chrono::duration<double, std::micro>(
    std::chrono::steady_clock::now() - start_time
  ).count();
```

`steady_clock` 适合计算经过时间；`duration<double, std::micro>` 把结果表示为微秒；`.count()` 取出数值。

`read()`、`write()` 和切换操作采用类似方式。测量得到的是该段代码的经过时间，可能包含等待和阻塞，不等于线程纯粹消耗的 CPU 时间。

| 指标 | 更新位置与含义 |
| --- | --- |
| `read_time` | Manager 的 read 阶段结束时更新 |
| `update_time` | Manager 的 update 阶段结束时更新 |
| `write_time` | Manager 的 write 阶段更新 |
| `total_time` | 在 write 阶段将 read、update、write 三项相加 |
| `switch_time` | `manage_switch()` 内记录的切换路径耗时 |
| `switch_perform_mode_time` | 执行硬件命令模式切换耗时 |
| `deactivation_time` | 停用控制器耗时 |
| `switch_chained_mode_time` | 控制器链式模式转换耗时 |
| `activation_time` | 激活控制器耗时 |

切换相关数值在每次 update 开始时清零，发生相应操作后才更新。它们是阶段内的细分指标，不能再全部加到 `total_time` 上，否则重复计算。

## 数值怎样发布出去

Manager 初始化统计集合和后台发布线程，在控制循环相应位置请求异步发布。流程是：

```text
初始化时注册指标及变量地址
            ↓
控制循环测量耗时并赋值
            ↓
统计框架采集数据
            ↓
后台发布统计消息
```

本快照默认提供：

```text
/controller_manager/statistics/full
/controller_manager/statistics/names
/controller_manager/statistics/values
```

`full` 包含名称和值；`names` 与 `values` 分开传输，可供可视化工具配对使用。它们的前缀受节点命名空间和重映射影响。接口数据另有 `~/introspection_data/...` 系列，不能与耗时统计混为一组。

容器中可以先发现实际话题，再采样：

```bash
ros2 topic list | grep /controller_manager/statistics
ros2 topic info /controller_manager/statistics/full
ros2 topic echo /controller_manager/statistics/full --once
```

数值更新、采集与发布不是同一个动作。看到某条统计消息，不能直接把所有跨线程事件都认定为同一个精确时刻；严格因果分析应结合 tracing。

## 执行耗时 周期和抖动

假设 Manager 目标频率为 100 Hz，每轮周期预算是 10 ms，也就是 10000 μs。

如果 `total_time` 为 12000 μs，说明这轮测量的三个阶段之和已经超过预算。如果它只有 1000 μs，也不能仅凭这个数字保证每 10 ms 准时开始一轮，因为线程仍可能因系统调度等原因晚启动。

| 量 | 回答的问题 |
| --- | --- |
| 执行耗时 | 一轮工作花了多久 |
| 实际周期 | 相邻控制轮次之间隔了多久 |
| 周期抖动 | 实际间隔偏离目标间隔多少 |
| 通信延迟 | 消息或请求到达消费者用了多久 |
| 设备响应时间 | 下发命令后设备状态多久改变 |

RRBot 慢慢接近目标，主要是示例模型的响应规律，不应先归因于 Executor 太慢。相反，服务响应慢也不能自动证明硬件 `write()` 慢，需要沿各自路径测量。

`total_time` 不包含控制线程为等待下一周期主动 sleep 的时间，也不是整个系统所有节点的总耗时。异步组件还需要观察自己的执行指标，不能只看同步 Manager 的这一个数。

## 按证据定位瓶颈

先记录配置、硬件、构建模式、输入负载和测量时段，再比较同等条件下的数据。本机学习镜像以 Debug 构建，不能把它的耗时直接当作 Release 版本或产品设备的基准。

| 观察到的现象 | 下一步应检查什么 |
| --- | --- |
| read 或 write 耗时长 | 通信等待、超时、设备轮询和驱动日志 |
| update 耗时长 | 各控制器计算、分配、锁竞争和切换路径 |
| 耗时短但周期不稳定 | 线程调度、CPU 竞争、系统负载与唤醒延迟 |
| 回调处理延迟 | Executor、回调组和长回调阻塞 |
| 大消息传输开销高 | 消息大小、复制、序列化、QoS 与通信方式 |
| 最终反馈慢 | 实际设备能力、模拟模型、目标轨迹与控制参数 |

同步热点中可以考虑减少动态分配、重复查找、无界等待和不必要日志；线程与回调组安排应依据共享数据和优先级设计。增加线程数量、提高更新频率、修改 QoS 都不是通用修复。

至少同时观察平均值、分位数、最大观测值、超时次数和样本数。一次实验里的最大值只是观察结果，不等于经过证明的最坏执行时间上界。

## 用 tracing 补上执行过程

`ros2_tracing` 记录回调等事件，结合分析工具可以观察执行持续时间和线程活动。统计指标适合持续观察，tracing 适合解释一次延迟究竟发生在哪个环节。可从 [ros2_tracing 项目][tracing-source] 开始。

常见的跨层问题需要把三段时间连起来：消息何时到达、回调何时执行、控制循环何时采用目标。仅有最终 `/joint_states` 数值不足以重建完整因果关系。

Mac 上的 Docker 环境适合学习功能和工具；实际实时性能还受 Linux 虚拟机与宿主机调度影响。需要给目标机器人下结论时，应在目标 Linux、相应内核、权限与部署配置下重新测量。

## 书籍和资料怎样搭配阅读

综合书适合建立结构，性能与实时专题还要配合官方设计文档和工具实验。

| 资料 | 阅读用途 |
| --- | --- |
| [A Concise Introduction to Robot Programming with ROS 2 第 2 版][concise-book] | 建立节点、机器人程序和软件结构的整体认识 |
| [Mastering ROS 2 for Robotics Programming 第 4 版][mastering-book] | 配合 Jazzy 做控制、建模与机器人综合实践 |
| [Introduction to Real time Systems][realtime-design] | 理解截止时间、确定性与实时编程背景 |
| [ros2_tracing][tracing-source] | 学习执行过程记录与分析 |
| [ros2 performance 框架][performance-source] | 设计通信延迟、可靠性、CPU 和内存实验 |

这两本是综合编程书，不应当作单独覆盖全部性能优化的专著。对 ros2_control 的学习顺序可以是：读懂控制循环，观察阶段耗时与周期，再用 tracing 解释异常，最后改动并比较结果。

## 复习练习

在不改变控制配置的情况下，先采一段空闲统计，再发送目标并观察一次控制器切换。记录是否出现切换耗时以及哪些阶段变化。把“命令数值变化”和“执行时间变化”放在不同列中，避免混用。

过关标准是能指出每个指标的注册位置、赋值位置和发布路径，并能解释为什么平均执行很快仍然可能达不到实时要求。

## 源码入口

- [统计变量与类型][statistics-members]。
- [指标注册][statistics-register]。
- [update_time 赋值][update-time]。
- [write_time 与 total_time 赋值][write-time]。
- [统计与内部变量观察文档][introspection-doc]。

[statistics-members]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/include/controller_manager/controller_manager.hpp#L705
[statistics-register]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L1223
[update-time]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L3595
[write-time]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L3680
[introspection-doc]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/doc/introspection.rst
[tracing-source]: https://github.com/ros2/ros2_tracing
[realtime-design]: https://design.ros2.org/articles/realtime_background.html
[performance-source]: https://github.com/ros2/ros2-performance
[concise-book]: https://www.routledge.com/A-Concise-Introduction-to-Robot-Programming-with-ROS-2/Rico/p/book/9781003516798
[mastering-book]: https://github.com/PacktPublishing/Mastering-ROS-2-for-Robotics-Programming
