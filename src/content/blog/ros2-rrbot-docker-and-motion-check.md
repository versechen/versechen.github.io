---
title: "Docker 中运行 RRBot 并理解运动检查脚本"
description: "在 ROS 2 Jazzy 容器中验证位置命令和轨迹控制器切换，逐步解释 check_motion 脚本的客户端、回调、等待条件与 PASS 边界。"
pubDate: "2026-10-18"
tags: ["ROS 2", "Docker", "RRBot", "Jazzy"]
category: "机器人"
series: "ROS 2 与机器人控制"
seriesOrder: 8
draft: false
heroImage: '../../assets/images/cover-ros2-07.svg'
---

本篇属于 **ROS 2 与机器人控制** 系列，正文第 7 篇。[专题目录](/blog/ros2-series-guide/) · [上一篇](/blog/ros2-control-cycle-and-mock-hardware/) · [下一篇](/blog/ros2-statistics-and-performance/)

RRBot Example 1 可以把节点、服务、控制器、接口和状态反馈放到同一个可观察的实验里。无界面运行仍然具备完整的控制数据流，不需要先安装 RViz。

本篇使用配套的 `.docker/rrbot` 文件。[下载完整学习包](/downloads/ros2-control-learning.zip)，将其中的 `.docker/rrbot` 和 `doc/learning/ros2-series` 解压到 ros2_control 仓库根目录。它们是本文准备的构建与检查脚本，不是只克隆上游仓库就自动拥有的文件。

## 在宿主机启动容器

先启动 Docker，在 ros2_control 仓库根目录运行：

```bash
python3 .docker/rrbot/prepare_sources.py
docker compose -f .docker/rrbot/compose.yaml up -d --build
docker compose -f .docker/rrbot/compose.yaml logs -f
```

本机 Compose 默认使用已有的 `ros2-jazzy-learning:dev` 基础镜像。另一台机器没有这个镜像时，可将构建命令替换为：

```bash
ROS_BASE_IMAGE=ros:jazzy-ros-base \
  docker compose -f .docker/rrbot/compose.yaml up -d --build
```

依赖源码准备脚本会下载并缓存需要的配套源码，构建镜像时编译当前仓库和所需 Jazzy 包。启动命令设置 `gui:=false`，不启动 RViz。

另开宿主机终端，在仓库根目录进入已经配置好 ROS 环境的容器 shell：

```bash
docker compose -f .docker/rrbot/compose.yaml exec rrbot /rrbot-entrypoint.sh bash
```

后续未特别说明的 ROS 命令都在这个容器终端执行。

## 先确认组件与资源

```bash
ros2 control list_controllers
ros2 control list_hardware_components
ros2 control list_hardware_interfaces
ros2 topic info /joint_states --verbose
```

默认控制器中，`joint_state_broadcaster` 和 `forward_position_controller` 应为 active。轨迹控制器可能尚未加载，也可能是此前手动加载后处于 inactive，以实际列表为准。

硬件组件实例名为 `RRBot`，类型是 `system`，插件类型为：

```text
ros2_control_demo_example_1/RRBotSystemPositionOnlyHardware
```

两个位置命令接口由位置控制器占用；广播器读取状态接口。接口显示 available 和 claimed，分别表示当前可供使用及已经被申请的状态，不代表接口名称不同。

## 一次命令怎样得到反馈

先发送一次目标：

```bash
ros2 topic pub --once /forward_position_controller/commands \
  std_msgs/msg/Float64MultiArray '{data: [0.5, -0.5]}'
```

这里的数组顺序由控制器的 `joints` 配置决定。再观察：

```bash
ros2 topic echo /joint_states
```

反馈中的 `name` 与 `position` 应按同一消息内的对应关系解释，不能假设状态数组顺序永远与命令数组顺序相同。

RRBot 默认每次 read 只消除 1% 剩余误差，Manager 为 10 Hz。因此数值会缓慢接近目标。Ctrl+C 停止的是当前 `topic echo` 命令，不是后台 Compose 服务。

## check_motion 脚本的完整职责

运行自动检查：

```bash
python3 /ws/src/ros2_control/.docker/rrbot/check_motion.py \
  --positions 0.5 -0.5
```

脚本不是控制器，而是一个命令发布者和反馈观察者。它完成以下顺序：

```text
解析输入并创建节点
    ↓
订阅 /joint_states 并创建命令发布者
    ↓
调用 list_controllers，等待目标控制器 active
    ↓
等待命令订阅者被发现
    ↓
发布一次命令
    ↓
持续处理反馈，检查是否进入容差
    ↓
打印 PASS 或超时报错，清理节点
```

这个顺序很重要。发现了订阅者，只说明通信实体存在，不代表控制器已经激活。若在激活前发送一次命令，控制器或硬件的激活过程可能重置命令，导致检查一直等不到目标。

## 接收反馈为什么用字典

脚本里的回调：

```python
def receive(message):
    latest.update(zip(message.name, message.position))
```

将 `JointState` 中同下标的名字与数值配对，例如：

```text
joint1 → 0.48
joint2 → -0.48
```

随后用关节名查询状态，避免依赖发布数组的排序。订阅创建时传入的 `10` 是队列深度，不是 10 Hz。

## 为什么先调用 list_controllers

```python
client = node.create_client(
    ListControllers, "/controller_manager/list_controllers"
)
future = client.call_async(ListControllers.Request())
rclpy.spin_until_future_complete(node, future, timeout_sec=2)
```

服务返回控制器名称、类型、状态等信息。脚本从响应里寻找目标控制器，确认它为 active。`call_async` 发出请求并返回 Future；等待函数在处理节点工作期间推动响应完成，等待时间耗尽后脚本仍要检查结果。

从命令行执行 `ros2 control list_controllers`，查询的也是 Manager 的服务。命令行工具和 Python 检查节点是两种客户端，而不是两套管理机制。

## 为什么等待消息时要 spin_once

发布以后，脚本反复执行：

```python
rclpy.spin_once(node, timeout_sec=0.1)
```

让 Executor 有机会执行 `receive()`。随后检查两个关节的误差是否都小于 0.02 rad，并要求数值存在且有限。

如果只写一个不 spin 的普通忙等循环，`latest` 不会因为中间件收到消息就自己更新。`0.1` 是等待就绪的超时，不是目标控制频率。

脚本使用 `time.monotonic()` 计算截止时间，避免系统墙上时间调整干扰等待。默认运动超时 90 秒适应示例较慢的响应。

## 切换到轨迹控制器

先查看列表。只有目标轨迹控制器尚未加载时，才执行：

```bash
ros2 control load_controller joint_trajectory_position_controller \
  "$(ros2 pkg prefix --share ros2_control_demo_example_1)/config/rrbot_jtc.yaml" \
  --set-state inactive
```

再通过一次切换请求，停用原控制器、激活轨迹控制器：

```bash
ros2 control switch_controllers \
  --deactivate forward_position_controller \
  --activate joint_trajectory_position_controller --strict

python3 /ws/src/ros2_control/.docker/rrbot/check_motion.py \
  --mode trajectory --positions -0.3 0.3
```

两个控制器需要相同的位置命令接口，不能同时占用。切换请求让 Manager 协调接口交接，不应当把两个控制器各自强行激活。

检查结束后，切回并回零：

```bash
ros2 control switch_controllers \
  --deactivate joint_trajectory_position_controller \
  --activate forward_position_controller --strict

python3 /ws/src/ros2_control/.docker/rrbot/check_motion.py --positions 0 0
```

轨迹模式发布的是 `JointTrajectory` 话题，包含两个关节名和一个两秒目标点，不是通过 FollowJointTrajectory Action 检查动作结果。

## PASS 能说明什么

PASS 表示观察到两个关节的状态进入最终位置容差。它验证了这次运行中命令与反馈的基本连通性，但不等于轨迹全程跟踪合格、两秒内按时到达、真实电机完成运动或 Action 成功。

脚本发布前调用 `latest.clear()` 只清空应用字典，不会清空中间件里排队的消息。如果目标本来已经达到，或旧反馈正好匹配，也可能很快通过。需要严格证明“本次命令导致的新运动”，应增加反馈时间戳、新鲜度和起终点变化等判断。

## 修改与重启

回到宿主机仓库根目录：

```bash
docker compose -f .docker/rrbot/compose.yaml stop
docker compose -f .docker/rrbot/compose.yaml up -d
```

启动后默认控制器会重新加载，手工加载的轨迹控制器需要按新实例的列表处理。

`check_motion.py` 通过只读挂载使用宿主机版本，修改该脚本不需要重编译整个镜像。C++ 源码是在构建时复制进镜像的，修改后需执行 `up -d --build`。

## 复习问题

1. 为什么“服务存在”“订阅者存在”“控制器 active”不是同一个条件？
2. 检查脚本是在计算控制输出，还是发送目标并观察结果？
3. 为什么要按关节名解释反馈？
4. 为什么两秒轨迹可能需要几十秒才通过最终容差检查？
5. PASS 还不能证明哪些行为？

过关标准是能够手动完成一次前向命令和一次控制器切换，并从脚本逐行指出节点、客户端、发布者、订阅者和 Executor 各自的作用。

## 配套代码与上游资料

本机配套文件为 `.docker/rrbot/README.md`、`compose.yaml`、`Dockerfile`、`entrypoint.sh`、`prepare_sources.py` 与 `check_motion.py`。下载包保留了这些文件的目录结构。

- [官方 RRBot 示例源码](https://github.com/ros-controls/ros2_control_demos/tree/jazzy/example_1)。
- [本仓库 ListControllers 服务定义](https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager_msgs/srv/ListControllers.srv)。

本环境已验证位置命令到达、轨迹控制器切换及回零；更换依赖快照、控制器配置或模拟参数后，应重新观察实际行为。
