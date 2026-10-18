---
title: "Controller Manager 初始化 服务与控制器管理"
description: "沿机器人描述进入 Manager 的路径，拆解服务注册、std::bind、硬件生命周期和 add_controller_impl 的实际职责。"
pubDate: "2026-10-18"
tags: ["ROS 2", "ros2_control", "生命周期"]
category: "机器人"
series: "ROS 2 与机器人控制"
seriesOrder: 4
draft: false
heroImage: '../../assets/images/cover-ros2-09.svg'
---

本篇属于 **ROS 2 与机器人控制** 系列，正文第 3 篇。[专题目录](/blog/ros2-series-guide/) · [上一篇](/blog/ros2-node-executor-and-spin/) · [下一篇](/blog/ros2-interfaces-and-hardware-mapping/)

Controller Manager 把配置、控制器对象和硬件资源组织成可以运行的系统。它接收机器人描述，初始化 Resource Manager，提供管理服务，再让控制循环按周期调用硬件和控制器。理解这些阶段，比把它简单理解成“直接控制电机的类”更准确。

## 从机器人描述开始初始化

正常话题启动路径中，Manager 收到描述后执行：

```text
robot_description_callback
    ↓
init_resource_manager
    ↓ 检查是否成功
set_initial_hardware_components_state
    ↓
init_services
```

[init_resource_manager()][init-rm] 主要准备时钟、更新频率、Executor 等参数；必要时创建 Resource Manager；按配置导入命令限位；再调用 `load_and_initialize_components()` 加载硬件资源。

Resource Manager 解析每个 `<ros2_control>` 块，创建对应的驱动对象，初始化它并导入状态、命令接口。随后 `set_initial_hardware_components_state()` 按启动配置设置硬件生命周期状态。加载、初始化、配置和激活是不同阶段。

所以“已经收到了 URDF”不等于“硬件加载成功”，“对象存在”也不等于“已经可用于控制”。初始化失败时，应先查看前面的解析或插件错误，而不是只重试控制器命令。

## 创建服务是在登记通信入口

以列出硬件接口的服务为例，源码是：

```cpp
list_hardware_interfaces_service_ =
  create_service<controller_manager_msgs::srv::ListHardwareInterfaces>(
    "~/list_hardware_interfaces",
    std::bind(
      &ControllerManager::list_hardware_interfaces_srv_cb,
      this, _1, _2),
    qos_services,
    best_effort_callback_group_);
```

这段代码创建服务端，将请求处理函数绑定到当前对象，并保存服务对象。`create_service<类型>(参数...)` 是函数模板调用；`::` 表示命名空间或类作用域；左侧变量保存返回的智能指针，使服务持续存在。

| 参数 | 含义 |
| --- | --- |
| `ListHardwareInterfaces` | 服务类型，规定 Request 和 Response |
| `"~/list_hardware_interfaces"` | 私有服务名，默认解析为 `/controller_manager/list_hardware_interfaces` |
| `std::bind(...)` | 未来收到请求时执行的回调 |
| `qos_services` | 通信 QoS 配置 |
| `best_effort_callback_group_` | 回调所属的组 |

Callback Group 的变量名不是通信可靠性策略。不能因为名字里有 `best_effort`，就判断服务使用 DDS Best Effort。

`std::bind` 中的 `&ControllerManager::list_hardware_interfaces_srv_cb` 是成员函数指针，`this` 指定当前对象，`_1`、`_2` 分别代表调用回调时的请求与响应参数。效果可以理解为稍后执行：

```cpp
this->list_hardware_interfaces_srv_cb(request, response);
```

注册时没有执行这个函数。客户端请求到来后，由 Executor 调用它。服务对象是一个长期存在的通信实体，回调才是每次请求执行的处理逻辑。

## 服务在哪里被使用

执行：

```bash
ros2 control list_hardware_interfaces
```

命令行工具会作为服务客户端调用 Manager。调用关系是：

```text
命令行工具或其他 ROS 节点
    ↓ 服务请求
Manager 的服务端
    ↓ Executor 调度
绑定的回调
    ↓ 进程内调用
Resource Manager 等内部对象
    ↓ 服务响应
客户端得到结果
```

因此，在代码里找不到其他地方直接调用 `list_hardware_interfaces_service_`，并不代表它没有作用。这个成员持有服务对象，后续执行由 ROS 通信和 Executor 驱动。

## 设置硬件状态的服务

`set_hardware_component_state_service_` 是同一种用法，默认服务名为 `/controller_manager/set_hardware_component_state`。

例如下面是说明用的命令，要求已有一个叫 `LeftArm` 的硬件组件：

```bash
ros2 control set_hardware_component_state LeftArm active
```

这里的名称对应 `<ros2_control name="LeftArm">`，不是关节名，也不是插件类名。请求带有组件名称和目标生命周期状态。

回调执行 `resource_manager_->set_component_state(...)`，Resource Manager 找到硬件对象并执行必要的状态转换，最终进入驱动的 `on_configure()`、`on_activate()` 等方法。见 [硬件状态服务回调][hardware-state]。

这是启停和配置硬件的管理操作，不是每周期设置目标位置的入口。

## load_controller 与 add_controller_impl 的分工

配置确定控制器类型之后，`load_controller()` 通过 pluginlib 创建控制器对象，并将指针、名称、参数文件和统计信息组织成 `ControllerSpec`。

然后 [add_controller_impl()][add-controller] 完成接入工作：

1. 锁定管理操作，准备待更新的控制器列表，检查是否重名。
2. 准备节点选项、URDF、更新频率、关节限位等，调用 `controller.c->init(...)`。
3. 准备控制器链的记录和接口缓存。
4. 把控制器节点加入 Executor。
5. 将控制器加入列表，通过列表交接机制让控制线程看到更新后的内容。

它的返回类型：

```cpp
controller_interface::ControllerInterfaceBaseSharedPtr
```

表示控制器基类的共享智能指针。成功时返回控制器指针，失败通常返回 `nullptr`。

这里的列表交接是为了协调管理线程与控制线程：前者准备新列表，后者在合适的交接点使用它。不是在控制线程遍历某个容器时随意向同一个容器插入对象。

控制器的 `init()` 创建其 LifecycleNode，并调用 `on_init()`。加入 Executor 后，节点的 ROS 回调可以被处理；控制器仍要经过配置、接口分配和激活，才进入正常周期更新。

## 生命周期和卸载的关系

控制器生命周期常见路径是：

```text
对象创建与 init
    ↓
unconfigured
    ↓ configure
inactive
    ↓ 分配接口并 activate
active
    ↓ deactivate 并释放接口
inactive
```

卸载路径会拒绝直接卸载仍处于 active 的控制器。完成清理、关闭节点后，Manager 将其移出 Executor 和管理列表，再释放所持有的对象引用。

这行代码触发的是控制器节点的生命周期转换：

```cpp
const auto new_state = controller.c->get_node()->shutdown();
```

`const auto` 让编译器推导变量类型，并使该变量不可再赋值。它不是“自动卸载动态库”的语法。`shutdown()` 会触发初始化时注册的回调，停止控制器异步处理线程、调用 `on_shutdown()` 并释放接口，正常完成后进入 `FINALIZED`。

| 动作 | 作用范围 |
| --- | --- |
| LifecycleNode 的 `shutdown()` | 当前节点的生命周期关闭 |
| `rclcpp::shutdown()` | ROS 上下文关闭 |
| 控制器对象析构 | C++ 对象及其成员资源释放 |
| 插件动态库卸载 | 由加载器及底层库引用管理 |

这四件事要分开分析。具体动态库何时卸载，留到第五篇的 pluginlib 路径继续追踪。

## 复习问题

1. Manager 为什么在硬件初始化后才开放相应的管理服务？
2. `create_service`、回调执行、Resource Manager 操作分别发生在哪一步？
3. `std::bind` 中的成员函数指针、`this` 和占位符各负责什么？
4. `add_controller_impl()` 执行成功为什么不代表控制器已 active？
5. 如何区分关闭节点、销毁对象和卸载库？

过关标准是能从一条 CLI 命令追踪到服务回调，再追踪到 Resource Manager 或控制器对象，而不是只记住函数名称。

## 源码入口

- [硬件初始化][init-rm]。
- [服务创建][services]。
- [控制器对象创建][load-controller]。
- [控制器接入管理][add-controller]。
- [硬件状态服务回调][hardware-state]。
- [控制器关闭回调注册][shutdown-callback]。

[init-rm]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L811
[services]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L1206
[load-controller]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L1247
[add-controller]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L2447
[hardware-state]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L3232
[shutdown-callback]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_interface/src/controller_interface_base.cpp#L150
