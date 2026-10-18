---
title: "pluginlib 插件加载 对象创建与动态库卸载"
description: "从插件 XML、注册宏和动态库追到具体对象，理解基类指针的虚函数调用，以及节点关闭、对象析构和库卸载的区别。"
pubDate: "2026-10-18"
tags: ["ROS 2", "pluginlib", "C++"]
category: "机器人"
series: "ROS 2 与机器人控制"
seriesOrder: 6
draft: false
heroImage: '../../assets/images/cover-ros2-05.svg'
---

本篇属于 **ROS 2 与机器人控制** 系列，正文第 5 篇。[专题目录](/blog/ros2-series-guide/) · [上一篇](/blog/ros2-interfaces-and-hardware-mapping/) · [下一篇](/blog/ros2-control-cycle-and-mock-hardware/)

配置中只有 `robot_driver/ArmHardware` 或 `forward_command_controller/ForwardCommandController` 这样的字符串，程序为什么能调用对应类的方法？这依靠插件描述、动态库加载、对象工厂和 C++ 虚函数，而不是接口名自动变成函数地址。

控制器插件与硬件插件都可以使用 pluginlib，但它们继承的基类、配置来源和运行职责不同。本篇把两条路径放在一起比较。

## 直接创建对象与按配置创建对象

普通程序可以写死具体类：

```cpp
auto controller = std::make_shared<MyController>();
```

插件程序在运行时选择具体类：

```cpp
auto controller = loader_->createSharedInstance(controller_type);
```

前者要求调用处知道 `MyController`；后者的宿主主要依赖统一基类，具体类型由配置和已注册插件决定。控制器与硬件插件都运行在宿主进程中，加载插件本身不等于启动另一个可执行程序。

## 驱动和控制器分别从哪里指定

| 插件 | 类型配置来源 | 常见基类 | 运行职责 |
| --- | --- | --- | --- |
| 硬件系统插件 | URDF 的 `<hardware><plugin>` | `SystemInterface` | 初始化设备与执行硬件读写 |
| 普通控制器插件 | 控制器的 `type` 参数 | `ControllerInterface` | 声明接口并执行控制器更新 |
| 可串联控制器插件 | 控制器的 `type` 参数 | `ChainableControllerInterface` | 支持控制器之间的引用接口等 |

硬件插件的名字与关节名属于不同命名体系。一个驱动实例负责哪些关节，由同一 `<ros2_control>` 块解析后的配置传入；关节对应哪台物理电机，由驱动读取设备参数建立。

## 编译与注册阶段做了什么

仓库里的 `test_controller::TestController` 是一个真实可追踪的控制器例子。作者先实现 `ControllerInterface` 的派生类，并将代码编译为共享库。

插件描述文件是：

```xml
<library path="test_controller">
  <class
    name="controller_manager/test_controller"
    type="test_controller::TestController"
    base_class_type="controller_interface::ControllerInterface">
  </class>
</library>
```

对应关系为：

```text
对外插件名 controller_manager/test_controller
    ↓
C++ 类 test_controller::TestController
    ↓
动态库 test_controller
```

在 Linux 上，动态库通常表现为 `libtest_controller.so`。里面已经是编译后的机器码，不是运行时再解释 C++ 源文件。

源码末尾还有：

```cpp
PLUGINLIB_EXPORT_CLASS(
  test_controller::TestController,
  controller_interface::ControllerInterface)
```

这个宏使类能够通过插件工厂机制被创建。XML 提供类与库的描述，注册宏提供创建类对象所需的注册代码；构建系统导出描述，使 pluginlib 能通过 ROS 包索引发现它。单独写一个 XML 名称并不能凭空生成驱动。

具体例子见 [测试控制器的插件描述][test-xml] 和 [注册宏][test-registration]。

## 控制器在什么时候被实例化

配置可以为某个控制器实例指定类型。例如下面是说明用的测试控制器配置：

```yaml
controller_manager:
  ros__parameters:
    my_controller:
      type: controller_manager/test_controller
```

`my_controller` 是实例名，`controller_manager/test_controller` 是插件类型。相同类型可以创建多个实例，分别使用不同名字和参数。

Manager 的 `load_controller()` 检查插件类型是否可用，并调用：

```cpp
controller = loader_->createSharedInstance(controller_type);
```

内部过程是：

```text
收到插件类型字符串
    ↓
根据插件描述找到真实类和动态库
    ↓
必要时加载动态库
    ↓
通过工厂创建具体类对象并执行构造函数
    ↓
返回以基类类型持有的 shared_ptr
```

随后 Manager 才调用 `add_controller_impl()` 进行 `init()`、节点接入和列表管理。这也区分了 C++ 构造函数、控制器 `on_init()`、`on_configure()` 和 `on_activate()`。

## 硬件驱动对象存在哪里

Resource Manager 的 `load_hardware()` 使用另一种创建方式：

```cpp
auto interface = std::unique_ptr<HardwareInterfaceT>(
  loader.createUnmanagedInstance(hardware_info.hardware_plugin_name));

HardwareT hardware(std::move(interface));
container.emplace_back(std::move(hardware));
```

见 [硬件加载实现][load-hardware]。`createUnmanagedInstance()` 返回裸指针，由这里的 `unique_ptr` 接管；`std::move` 转移所有权，不复制一个新的驱动对象。

系统硬件对应的保存关系是：

```text
ResourceManager
  └─ resource_storage_
       └─ systems_ 中的 HardwareComponent
            └─ impl_ 智能指针
                 └─ 具体的 ArmHardware 对象
```

本快照中 `System` 是 `HardwareComponent` 的别名。驱动对象在初始化后导出接口，接口则登记到另外的接口表中。硬件容器与接口表不是同一份数据结构。

## 为什么基类指针能调用具体实现

用一个独立的 C++ 概念片段说明：

```cpp
struct Hardware {
  virtual ~Hardware() = default;
  virtual void write() = 0;
};

struct ArmHardware : Hardware {
  void write() override { /* 机械臂通信代码 */ }
};

std::unique_ptr<Hardware> hardware = std::make_unique<ArmHardware>();
hardware->write();  // 执行 ArmHardware::write
```

声明类型是基类，实际对象是派生类。因为 `write()` 是虚函数，运行时会进入实际对象的实现，这称为动态多态，通常由虚函数表完成。

不同设备不必各有一套函数。两台同型号电机可以使用相同类的两个对象，分别保存不同通信端口和设备编号；同一次 `write()` 实现使用不同对象数据，就能发给不同设备。一个系统级对象也可以循环处理多个关节。

## shutdown 是否等于卸载插件

下面这行只触发节点的生命周期关闭：

```cpp
const auto new_state = controller.c->get_node()->shutdown();
```

它执行已注册的关闭回调，进入控制器的 `on_shutdown()`、释放接口等流程。对象仍然可以存在，动态库也仍然可以加载着。

普通 `unload_controller()` 则继续把控制器移出 Executor 和管理列表，释放 Manager 持有的对象引用。最后一个共享引用释放时，对象才析构。如果其他代码还持有它，销毁会延后。

Jazzy 的 pluginlib 默认不启用随着对象数量变化的按需库卸载，因此控制器对象销毁不代表 `.so` 立即卸载。这个设置可在 [pluginlib 构造代码][pluginlib-source] 中看到。

## 真正的库卸载路径

本仓库的 `reload_controller_libraries_service_cb()` 先停用、卸载控制器，再用新加载器替换旧加载器：

```cpp
loader_ = std::make_shared<
  pluginlib::ClassLoader<controller_interface::ControllerInterface>
>(...);
```

旧加载器释放后，底层清理逻辑请求卸载其管理的库。若仍有插件对象或其他库引用，卸载可能被推迟或阻止，不能仅根据“卸载某个控制器成功”断言动态库已经从进程中移除。见 [加载器重建][reload-source] 与 [底层库卸载检查][class-loader-source]。

所以需要沿着四层分别追踪：

| 层次 | 对应动作 |
| --- | --- |
| 生命周期 | 停用、清理、shutdown |
| Manager 管理关系 | 从 Executor 和列表移除 |
| C++ 对象 | 引用释放后析构 |
| 动态库 | 加载器和底层引用管理完成卸载 |

重建加载器也不会自动恢复所有控制器实例；后续仍需按正常流程加载、配置和激活。

## 复习问题

1. 插件名、C++ 类名、动态库名各在哪里定义？
2. `createSharedInstance()` 和控制器 `init()` 分别完成什么？
3. 基类指针为什么可以调用不同驱动的 `write()`？
4. 同一驱动类的两个对象怎样区分物理设备？
5. 为什么 shutdown、对象析构和库卸载要分别观察？

过关标准是能从一个配置字符串追到具体构造函数，再追到虚函数执行，而不是把动态加载理解为字符串查找设备。

## 源码入口

- [控制器插件描述][test-xml]。
- [控制器注册][test-registration]。
- [硬件插件实例化][load-hardware]。
- [控制器插件实例化][load-controller]。
- [重建控制器加载器][reload-source]。
- [Jazzy pluginlib 实现][pluginlib-source]。
- [Jazzy class_loader 实现][class-loader-source]。

[test-xml]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/test/test_controller/test_controller.xml
[test-registration]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/test/test_controller/test_controller.cpp#L268
[load-hardware]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/hardware_interface/src/resource_manager.cpp#L164
[load-controller]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L1247
[reload-source]: https://github.com/ros-controls/ros2_control/blob/fd5744d6bb9b2b0fae010be411dbfb7ca65228ff/controller_manager/src/controller_manager.cpp#L3003
[pluginlib-source]: https://github.com/ros/pluginlib/blob/jazzy/pluginlib/include/pluginlib/class_loader_imp.hpp
[class-loader-source]: https://github.com/ros/class_loader/blob/jazzy/src/class_loader.cpp
