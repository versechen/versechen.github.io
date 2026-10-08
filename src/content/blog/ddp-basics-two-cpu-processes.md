---
title: '训练与推理入门（一）：从两个 CPU 进程看懂 PyTorch DDP'
description: '从一次 WSL 双进程训练出发，理清 rank、数据采样、batch、梯度同步和参数检查，并用完整代码与手算结果验证 DDP 的工作方式。'
pubDate: '2026-10-02'
updatedDate: '2026-10-08'
tags: ['PyTorch', 'DDP', '分布式训练', '训练与推理']
category: '训练与推理'
series: '训练与推理入门'
seriesOrder: 1
draft: false
heroImage: '../../assets/images/cover-spring.svg'
---

运行下面的 DDP 例子时，两组 loss 不一样，梯度和权重却完全一样。要理解程序打印的 `PASS`，需要回答几个问题：两个 rank 到底分到了什么数据？`set_epoch()` 在做什么？代码里没有写 `all_reduce()`，梯度是在哪里同步的？最后那句 `all_gather()` 又有什么用？

这篇把这些问题放回同一个小例子里讲清楚。模型只有一个参数，数据只有 8 条，在 Linux 或 WSL 上用两个 CPU 进程就能运行。先把每一步算明白，后面看多卡训练、通信日志和性能瓶颈，才有可以对照的基线。文中的练习都配有“查看答案”，可以先自行推算，再展开对照。

## 1. 训练、推理和 DDP 各自做什么

训练要根据样本调整模型参数。一次最基本的训练更新包括：前向计算得到预测，计算 loss，反向传播求梯度，最后由优化器更新参数。

推理使用已经训练好的参数产生结果，通常不需要反向传播和优化器更新。两者都涉及模型、设备和数据，但关注点不同：训练需要处理梯度、优化器状态和同步；推理部署还要考虑请求排队、批处理、延迟、吞吐和缓存。

DDP 的全称是 **DistributedDataParallel**，即分布式数据并行。这个例子中，每个进程都持有完整模型，读取分给自己的样本，计算本地 loss。DDP 把参与训练的进程的梯度同步起来，各进程再用相同的优化规则更新自己的模型。

因此，DDP 不会把一个大模型拆成两半。完整模型放不进单张卡时，还需要研究参数分片、张量并行或流水线并行等方案。本篇先验证数据并行的基本行为。

## 2. 先认清进程的三个编号

进程可以理解为一次独立运行的 Python 程序：有自己的变量、模型、优化器和地址空间。DDP 中的 `rank` 是进程在通信组里的编号。

| 名称 | 含义 | 本文的两进程例子 |
| --- | --- | --- |
| `rank` | 默认通信组内的全局进程编号 | `0`、`1` |
| `world_size` | 默认通信组内的进程总数 | 两个进程都看到 `2` |
| `local_rank` | 同一节点内的进程编号 | 本机分别为 `0`、`1` |

这里的节点是一台机器或一个独立运行环境，不能直接把它理解为 Kubernetes 的 Pod。实际部署时，Pod、机器和训练进程如何对应，要由启动方式决定。

单机时，`rank` 和 `local_rank` 的数值碰巧相同。假设两台机器各启动两个进程，一种常见编号方式是：

| 节点 | `rank` | `local_rank` | `world_size` |
| --- | ---: | ---: | ---: |
| 第一台 | 0 | 0 | 4 |
| 第一台 | 1 | 1 | 4 |
| 第二台 | 2 | 0 | 4 |
| 第二台 | 3 | 1 | 4 |

多 GPU DDP 常用一个进程管理一张 GPU，使用 `local_rank` 选择当前进程可见的设备。但进程数本身不等于 GPU 数：本文两个进程都运行在 CPU 上。

### 启动命令逐项解释

```bash
OMP_NUM_THREADS=1 python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 ddp_lesson01.py
```

| 部分 | 作用 |
| --- | --- |
| `OMP_NUM_THREADS=1` | 为这条命令设置 OpenMP 线程数，减少两个 CPU 进程争抢线程的情况 |
| `python -m torch.distributed.run` | 用当前 Python 环境启动分布式运行器；与 `torchrun` 使用同一个入口 |
| `--standalone` | 为单机运行准备 rendezvous，也就是让各进程找到并加入同一次任务的会合机制 |
| `--nnodes=1` | 只使用一个节点 |
| `--nproc-per-node=2` | 在本节点启动两个训练进程 |
| `ddp_lesson01.py` | 每个训练进程都会执行的脚本 |

`OMP_NUM_THREADS=1` 控制的是线程，`--nproc-per-node=2` 控制的是进程。运行器会向训练进程注入 `RANK`、`WORLD_SIZE`、`LOCAL_RANK` 等环境变量；脚本中的 `init_process_group()` 利用这些信息建立通信组。

启动参数可对照 [torchrun 官方文档](https://docs.pytorch.org/docs/stable/elastic/run.html)，线程设置可对照 [PyTorch 线程环境变量说明](https://docs.pytorch.org/docs/stable/threading_environment_variables.html)。

## 3. 准备一个可以手算的完整例子

本文使用 Linux／WSL、Python 3.10–3.12、PyTorch 2.5.1 的 CPU 版本。固定版本是为了方便复验这次练习，不代表它是当前最新版本。无需 GPU、CUDA、NCCL 或 Kubernetes。

新建环境时可以执行：

```bash
python3 -m venv .venv-ddp
source .venv-ddp/bin/activate
python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
python -m pip install numpy
python -c 'import torch; print(torch.__version__)'
```

CPU wheel 的安装方式来自 [PyTorch 历史版本安装页](https://pytorch.org/get-started/previous-versions/)。这个例子不使用 NumPy；安装它是为了避免出现缺少 NumPy 的初始化警告。已有环境可以直接复用，先确认 `python` 指向相应虚拟环境。

在 Ubuntu 22.04 上，如果创建虚拟环境提示缺少 `venv`，可执行：

```bash
sudo apt update
sudo apt install python3.10-venv
```

我这次安装遇到的 `.deb` 下载 404，刷新 APT 索引后再安装是首先应做的检查。404 表示请求的包地址不存在；WSL 的 localhost 代理提示则要另外检查网络配置，两者不能仅凭同时出现就判定为同一个问题。

### 数据和模型

8 条输入分别是：

$$
x=\left[\frac18,\frac28,\ldots,\frac88\right],\qquad y=2x
$$

模型只有一个权重，没有偏置：

$$
\hat y=wx
$$

初始值设为 $w=0$，目标是让它逐渐接近 $2$。`Linear(1, 1, bias=False)` 恰好实现这个模型。每个 rank 使用本地 batch 的均方误差，优化器为学习率 `0.1` 的 SGD。

### 保存为 ddp_lesson01.py

```python
import os
from datetime import timedelta

import torch
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader, DistributedSampler, TensorDataset


def main():
    torch.set_num_threads(1)
    dist.init_process_group("gloo", timeout=timedelta(seconds=60))

    try:
        rank = dist.get_rank()
        world = dist.get_world_size()
        local_rank = int(os.environ["LOCAL_RANK"])
        if world != 2:
            raise ValueError("This lesson requires exactly two workers.")

        x = torch.arange(1, 9, dtype=torch.float32).reshape(-1, 1) / 8
        dataset = TensorDataset(x, 2 * x)
        sampler = DistributedSampler(
            dataset, num_replicas=world, rank=rank, shuffle=False
        )
        loader = DataLoader(dataset, batch_size=4, sampler=sampler)
        print(
            f"rank={rank} local_rank={local_rank} world_size={world} "
            f"indices={list(sampler)}",
            flush=True,
        )

        model = torch.nn.Linear(1, 1, bias=False)
        with torch.no_grad():
            model.weight.zero_()
        model = DDP(model)
        optimizer = torch.optim.SGD(model.parameters(), lr=0.1)

        for epoch in range(5):
            sampler.set_epoch(epoch)
            for xb, yb in loader:
                optimizer.zero_grad(set_to_none=True)
                loss = (model(xb) - yb).square().mean()
                loss.backward()  # DDP 在反向传播过程中同步梯度
                gradient = model.module.weight.grad.item()
                optimizer.step()

                # 收集各 rank 的权重，用来检查更新结果
                weight = model.module.weight.detach().flatten().clone()
                replicas = [torch.zeros_like(weight) for _ in range(world)]
                dist.all_gather(replicas, weight)
                gap = (
                    torch.stack(replicas) - replicas[0]
                ).abs().max().item()
                assert gap < 1e-6, f"Replica mismatch: {gap}"

                if epoch == 0:
                    assert abs(gradient + 1.59375) < 1e-6
                    assert abs(weight.item() - 0.159375) < 1e-6

                print(
                    f"rank={rank} epoch={epoch} loss={loss.item():.6f} "
                    f"grad={gradient:.6f} w={weight.item():.6f} "
                    f"max_gap={gap:.2e}",
                    flush=True,
                )

        if rank == 0:
            print(
                "PASS: five updates, equal replicas, correct first gradient.",
                flush=True,
            )
    finally:
        dist.destroy_process_group()


if __name__ == "__main__":
    main()
```

再用上一节的双进程命令运行。不要直接执行 `python ddp_lesson01.py`，因为那样没有运行器提供的分布式环境变量。

## 4. 数据集、采样器和 batch 是怎样连起来的

这三个对象各有一份明确的工作：

| 对象 | 负责什么 | 本文对应内容 |
| --- | --- | --- |
| `Dataset` | 根据索引返回样本 | `dataset[0]` 返回输入 `1/8` 和标签 `2/8` |
| `Sampler` | 产生当前进程要读取的索引顺序 | rank 0 得到 `[0, 2, 4, 6]` |
| `DataLoader` | 按索引读取样本，再组成 batch | 每次把本地 4 个样本合成一批 |

**索引从 0 开始，输入值从 `1/8` 开始。** 日志中的 `indices=[0, 2, 4, 6]` 是数据集的位置，实际输入是 `[1/8, 3/8, 5/8, 7/8]`。rank 1 的索引是 `[1, 3, 5, 7]`，实际输入是 `[2/8, 4/8, 6/8, 8/8]`。

本文中，每个进程都会构造包含全部 8 条数据的 `dataset`。采样器决定它在本轮取哪些样本。对于磁盘上的数据，各进程也需要能够访问对应文件；DDP 不负责把训练数据自动发送到其他节点。

### 不打乱时怎样分配

当 `shuffle=False` 时，全局索引顺序为 `[0, 1, 2, 3, 4, 5, 6, 7]`。在长度可以整除进程数的这个例子中，可以把分配方式理解成：

```python
local_indices = global_indices[rank::world_size]
```

| rank | 本轮索引 | `batch_size=4` 时的 batch 数量 |
| --- | --- | ---: |
| 0 | `[0, 2, 4, 6]` | 1 |
| 1 | `[1, 3, 5, 7]` | 1 |

所以这里每个 epoch 各进程执行一次 `optimizer.step()`。5 个 epoch 对应每个模型副本 5 次更新。

`batch_size=4` 是**每个进程的本地 batch 大小**。在本文进程数为 2、没有梯度累积的前提下，一次同步更新合计使用 8 条样本。以后引入梯度累积时，等大小 batch 下的有效 batch 大小通常还要乘以累积步数。

### batch 的索引一定固定吗

batch 的成员由本轮索引顺序和 batch 大小共同决定，不会永久固定。把 `batch_size` 改成 `2`，rank 0 本轮会依次取 `[0, 2]` 和 `[4, 6]`，rank 1 则依次取 `[1, 3]` 和 `[5, 7]`。每个 rank 都有两批，因此在每批执行一次 `optimizer.step()` 的写法下，每轮各更新两次。

这里是在分析修改后的数据分组；完整脚本的首轮数值断言和末尾“五次更新”提示都基于 `batch_size=4`，不能在改成 `2` 后原样沿用。

启用 shuffle 后，索引顺序会变，batch 的成员也会随之变化。batch 可以看作当前遍历中的一组样本，它并没有天然固定的数据集身份。

### 数据长度不能整除时

`DistributedSampler` 默认 `drop_last=False`，会补充索引，让各 rank 分到一样多的样本。这种情况下，同一条样本可能在一轮中重复出现。例如 5 条数据、2 个 rank、`shuffle=False`：

```text
补齐后的全局索引：[0, 1, 2, 3, 4, 0]
rank 0：[0, 2, 4]
rank 1：[1, 3, 0]
```

采样器设置 `drop_last=True` 时，会丢弃尾部索引，使各 rank 的样本数相等。上面 5 条数据的例子会先截为 `[0, 1, 2, 3]`，再分给 rank 0 `[0, 2]`、rank 1 `[1, 3]`；索引 `4` 在这一轮被丢弃。`DataLoader(drop_last=True)` 则是在采样之后，丢弃本地不足一个 batch 的最后一批；两处 `drop_last` 所处的步骤不同。

这一细节在计算验证集指标时尤其容易遗漏：如果直接累加所有 rank 的样本结果，补齐的样本可能被重复计入。采样和补齐行为见 [DistributedSampler 文档](https://docs.pytorch.org/docs/stable/data.html#torch.utils.data.distributed.DistributedSampler)。

## 5. epoch 和 set_epoch() 到底是什么关系

```python
for epoch in range(5):
    sampler.set_epoch(epoch)
    for xb, yb in loader:
        ...
```

`for epoch in range(5)` 让 Python 依次执行 5 轮循环，`epoch` 的值为 `0` 到 `4`。这个局部变量不会自动传给采样器。

`sampler.set_epoch(epoch)` 把轮次记录到采样器中。真正开始遍历 `loader` 时，采样器才根据当前配置和轮次产生索引顺序。因此应在**创建本轮 DataLoader 迭代器之前**调用它。

在 PyTorch 2.5.1 中，`shuffle=True` 时，`DistributedSampler` 使用独立随机数生成器，以 `seed + epoch` 为种子产生全局随机排列，再为各 rank 取出相应索引。

同一轮中，所有 rank 需要使用相同的 seed 和 epoch。这样它们才能基于同一个全局排列划分数据。若各 rank 自己使用不同的种子，就可能重复读取部分样本，同时漏掉另一些样本。

这个例子设置 `shuffle=False`，所以 5 轮的采样顺序都一样，`set_epoch()` 不会改变结果。代码保留这一行，是为了沿用训练循环的常见写法；就这份不打乱的例子而言，删掉它也不会影响索引。

换成 `shuffle=True` 后，如果始终不调用 `set_epoch()`，采样器会一直使用默认的 epoch 值，每轮重复同一个随机排列。它不知道外层 Python 循环已经进入下一轮。

### 为什么看起来像 rank 交换了数据

假设某一轮的全局排列是下面这个顺序。这里只是演示分配规则，不代表某个指定 seed 的实际输出：

```text
[5, 2, 7, 0, 1, 6, 3, 4]
```

取交错位置后，`batch_size=2` 得到：

| rank | 本轮索引 | 第一批 | 第二批 |
| --- | --- | --- | --- |
| 0 | `[5, 7, 1, 3]` | `[5, 7]` | `[1, 3]` |
| 1 | `[2, 0, 6, 4]` | `[2, 0]` | `[6, 4]` |

某条样本本轮归 rank 0、下轮归 rank 1，是正常的数据分配变化。两个进程都访问原始数据集，分别计算自己本轮应取的索引。采样器在这一步只处理索引，不会把上一轮 rank 0 内存中的样本传送给 rank 1。

因此，“每个 rank 永久拥有一份固定的数据”不适合作为启用 shuffle 后的理解方式。更准确的说法是：**每轮先确定全局顺序，再按 rank 划分本轮任务。**

实现细节可对照 [PyTorch 2.5.1 的采样器源码](https://github.com/pytorch/pytorch/blob/v2.5.1/torch/utils/data/distributed.py)。

## 6. 梯度同步藏在哪一行

关键是这两处：

```python
model = DDP(model)
...
loss.backward()
```

DDP 包装模型时，会为参数的梯度累积注册钩子，并初始化相关通信状态。反向传播过程中，梯度就绪后触发同步；在默认的同步训练路径下，`backward()` 返回后，参数上的 `.grad` 已经是同步后的梯度。

这就是代码没有显式写 `dist.all_reduce()`，两个 rank 的 `grad` 仍然相同的原因。AllReduce 是集合通信的一种：把各进程的值按规则归约，并让各进程得到归约结果。默认 DDP 会通过归约和缩放得到各 rank 梯度的平均值；实际实现会把参数梯度组织成 bucket 来通信。

| 代码 | 本例中的作用 |
| --- | --- |
| `model.weight.zero_()` | 把初始权重设为 0；`no_grad()` 避免把初始化记进计算图 |
| `DDP(model)` | 包装模型，初始化副本并准备反向传播的梯度同步 |
| `optimizer.zero_grad(set_to_none=True)` | 清理上一轮留下的梯度，避免意外累加 |
| `model(xb)` | 用本地输入计算预测值 |
| `.square().mean()` | 对本地样本计算均方误差 |
| `loss.backward()` | 自动求导，并在 DDP 默认路径中同步梯度 |
| `model.module.weight.grad` | 访问 DDP 包装内部模型的梯度 |
| `optimizer.step()` | 每个 rank 使用自己的优化器更新本地权重 |

`module` 是包装内部的原始模型，`.item()` 则把这里的单元素张量转换成 Python 数值，方便打印。

DDP 在初始化时会同步模型状态。随后，只要各 rank 使用相同的参数起点、同步后的梯度、优化器配置与状态，并执行一致的更新步骤，模型参数就可以保持一致。训练时无需在每一步再手动把权重取平均。

需要把这个前提记住。`no_sync()`、自定义通信钩子、不同的优化器状态、某个 rank 单独修改参数等情况，会改变上述推理。默认梯度同步机制见 [DDP 设计说明](https://docs.pytorch.org/docs/stable/notes/ddp.html)。

### 为什么 loss 不一样，梯度却一样

每个 rank 的 loss 是根据各自样本计算的。本例没有同步 loss，因此两个数值不同完全正常。反向传播之后打印的梯度，已经经过 DDP 同步。

也要注意打印时间：日志中的 `loss` 属于本次更新**之前**的前向计算，`w` 则是在 `optimizer.step()` **之后**读取的权重。

如果希望报告覆盖全部 rank 的平均 loss，需要另外归约指标；当本地样本数不同，还要按样本数加权。不能从 DDP 同步了梯度，推导出它也自动同步了每一个日志指标。

## 7. 把第一次更新手算出来

本地 batch 有 $B$ 个样本，均方误差为：

$$
L_r(w)=\frac1B\sum_{i\in\mathcal B_r}(wx_i-2x_i)^2
$$

对 $w$ 求导：

$$
g_r(w)=\frac{2(w-2)}B\sum_{i\in\mathcal B_r}x_i^2
$$

初始 $w=0$，所以 $g_r(0)=-4\operatorname{mean}(x_i^2)$。两个 rank 的计算结果分别是：

| 项目 | rank 0 | rank 1 |
| --- | ---: | ---: |
| 数据索引 | `[0, 2, 4, 6]` | `[1, 3, 5, 7]` |
| 输入的平方均值 | `0.328125` | `0.468750` |
| 本地 loss | `1.312500` | `1.875000` |
| 同步前的本地梯度 | `-1.312500` | `-1.875000` |

DDP 同步后的平均梯度是：

$$
g=\frac{-1.3125-1.875}{2}=-1.59375
$$

两个进程各自执行同一个 SGD 更新：

$$
w_1=w_0-0.1g=0-0.1\times(-1.59375)=0.159375
$$

这两项对应代码里的首轮断言。`loss.backward()` 后读取的 `.grad` 应该是 `-1.59375`，而不是上表中的本地梯度。

由于两个本地 batch 的样本数相等，平均本地梯度等价于在全部 8 条样本上计算 mean loss 的梯度。这个等价关系有条件：若各 rank 的样本数不同，直接平均各 rank 的 mean 梯度并不自动等于按全部样本计算的平均梯度。

### 实际运行日志应该怎么看

下面是这次 WSL 运行记录中的首轮和末轮，按 rank 整理后展示：

```text
rank=0 local_rank=0 world_size=2 indices=[0, 2, 4, 6]
rank=1 local_rank=1 world_size=2 indices=[1, 3, 5, 7]

rank=0 epoch=0 loss=1.312500 grad=-1.593750 w=0.159375 max_gap=0.00e+00
rank=1 epoch=0 loss=1.875000 grad=-1.593750 w=0.159375 max_gap=0.00e+00

rank=0 epoch=4 loss=0.675432 grad=-1.143303 w=0.679597 max_gap=0.00e+00
rank=1 epoch=4 loss=0.964903 grad=-1.143303 w=0.679597 max_gap=0.00e+00
PASS: five updates, equal replicas, correct first gradient.
```

两进程的标准输出可能交错，甚至拼到一行；`flush=True` 不会对多个进程的输出做全局排序。这不影响训练是否正确。

末轮权重约为 `0.679597`，说明已经朝目标 `2` 更新了 5 步。`PASS` 表示程序走完了 5 次更新，每步副本权重差值都小于 `1e-6`，且首步梯度和权重通过了数值断言。代码没有逐步断言后续权重是否等于理论值，也没有检查是否收敛。

## 8. all_gather 收集的到底是什么

训练更新之后，代码执行：

```python
weight = model.module.weight.detach().flatten().clone()
replicas = [torch.zeros_like(weight) for _ in range(world)]
dist.all_gather(replicas, weight)
```

`detach()` 得到不参与自动求导的张量，`flatten()` 把权重整理成一维，`clone()` 保留当前值的副本。这里只检查一个标量参数，大模型检查时通常需要更有针对性的方式。

每个 rank 都准备两个接收张量。`all_gather()` 调用完成后，**每个 rank** 的 `replicas` 都按 rank 顺序保存所有进程提交的权重：

```python
[
    tensor([0.159375]),  # rank 0 提交的权重
    tensor([0.159375]),  # rank 1 提交的权重
]
```

这份正确运行的例子里，它们应该一样。`all_gather()` 的作用是把各 rank 的值收集起来；它不平均权重，也不把不同的参数修正成相同值。

假设有人在 rank 1 上单独修改了权重，收集结果才可能变成两个不同的数。那时差异反映的是提交前的真实状态，收集操作只是把问题展示出来。

紧接着的检查是：

```python
gap = (torch.stack(replicas) - replicas[0]).abs().max().item()
assert gap < 1e-6
```

`stack()` 把收到的张量叠起来，逐个与 rank 0 的权重比较，再取最大绝对差值。日志中的 `max_gap=0.00e+00` 表示这次检查没有发现权重差异。

| 通信 | 本文作用 | 会不会负责本例的训练梯度同步 |
| --- | --- | --- |
| DDP 反向传播中的 AllReduce | 归约并平均梯度 | 会 |
| 显式 `dist.all_gather()` | 收集更新后的权重，检查副本 | 不会 |

所有参与这个通信组的 rank 都要按匹配的顺序执行集合通信。即便只让 rank 0 打印结果，也不能仅让 rank 0 调用 `all_gather()`。

每一步收集权重会增加通信开销，本文是为了观察行为才这样做。一般训练不需要保留这段诊断。API 语义见 [all_gather 文档](https://docs.pytorch.org/docs/stable/distributed.html#torch.distributed.all_gather)。

## 9. 做三次小验证，检查自己是否理解

### 验证一：观察采样顺序

保存下面的代码为 `sampler_probe.py`，在同一虚拟环境执行 `python sampler_probe.py`。这个检查不启动通信进程，用两个采样器模拟两个 rank 的索引分配。

```python
from torch.utils.data import DistributedSampler

dataset = list(range(8))

for shuffle in (False, True):
    for advance_epoch in (False, True):
        samplers = [
            DistributedSampler(
                dataset, num_replicas=2, rank=rank,
                shuffle=shuffle, seed=2026,
            )
            for rank in range(2)
        ]
        print(f"\nshuffle={shuffle}, set_epoch={advance_epoch}")
        for epoch in range(3):
            if advance_epoch:
                for sampler in samplers:
                    sampler.set_epoch(epoch)
            parts = [list(sampler) for sampler in samplers]
            assert len(parts[0]) == len(parts[1]) == 4
            assert sorted(parts[0] + parts[1]) == list(range(8))
            print(f"epoch={epoch}: rank0={parts[0]}, rank1={parts[1]}")
```

运行前先预测：四种配置下，两个 rank 的索引是否会随 epoch 改变？每轮合并后是否仍恰好覆盖 `0–7`？

<details>
<summary>查看答案：四种采样配置与验收结果</summary>

四种配置的答案如下：

| `shuffle` | 调用 `set_epoch()` | 三轮的预期结果 |
| --- | --- | --- |
| `False` | 否 | 每轮 rank 0 都是 `[0, 2, 4, 6]`，rank 1 都是 `[1, 3, 5, 7]` |
| `False` | 是 | 与上一行完全相同；不打乱时，epoch 不参与排列 |
| `True` | 否 | 采样器始终保留默认 epoch `0`，以种子 `2026` 生成排列；两个 rank 各自的顺序每轮重复 |
| `True` | 是 | 三轮分别以 `2026 + 0`、`2026 + 1`、`2026 + 2` 为种子重新生成排列，再按 rank 交错切分；具体索引以脚本输出为准 |

`shuffle` 决定是否使用随机排列，`set_epoch()` 为随机排列提供本轮的轮次。只有打乱已启用时，改变轮次才参与改变排列。固定 seed 和 epoch 可以复现同一份顺序；有限的排列空间也意味着不同 epoch 并不具有“排列绝对不能重复”的数学保证。

8 条数据可以被两个 rank 整除，所以本验证不用补齐。四种配置的每一轮都应满足：两个 rank 各有 4 个索引，合并后恰好覆盖 `0–7`，没有重复或遗漏。脚本中的两条断言检查这些性质；是否跨轮重复则对照打印的索引和上表检查。不同 epoch 使用不同种子，不等于保证每一轮排列都不同。

</details>

### 验证二：移除参数检查

复制 `ddp_lesson01.py` 为 `ddp_no_gather.py`。保留 `weight = model.module.weight.detach().flatten().clone()`，将从 `replicas = ...` 到 `assert gap < 1e-6` 的代码删掉，把循环内的日志打印替换为下面这段，其余训练逻辑保持原样：

```python
                print(
                    f"rank={rank} epoch={epoch} loss={loss.item():.6f} "
                    f"grad={gradient:.6f} w={weight.item():.6f}",
                    flush=True,
                )
```

再运行：

```bash
OMP_NUM_THREADS=1 python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 ddp_no_gather.py
```

同时删去末尾原来的 `PASS` 打印，避免它继续声称已检查副本相等。先预测：两个 rank 的首轮梯度、首轮权重和最终权重会不会改变？

<details>
<summary>查看答案：去掉 all_gather 后哪些数值不变</summary>

这几个训练数值应该保持不变：首轮梯度 `-1.593750`，首轮权重 `0.159375`，第五步后权重约 `0.679597`。梯度同步仍由 DDP 在反向传播中完成。删除 `all_gather()` 后，只是失去了程序内比较权重的检查；可以对照两个 rank 的打印值观察结果。

</details>

### 验证三：从日志判断哪里有问题

假设两个 rank 都从 `w=0` 开始，使用上面的数据、本地 mean loss 和学习率 `0.1` 的 SGD。第一轮打印：

```text
rank=0 loss=1.312500 grad=-1.312500 w=0.131250
rank=1 loss=1.875000 grad=-1.875000 w=0.187500
```

这些是用于分析的假设日志，不是本次实际测量。仅凭这组数据，哪个环节最值得先检查？

<details>
<summary>查看答案：先检查梯度同步路径</summary>

两个梯度分别等于手算的本地梯度，两个权重也分别按本地梯度完成了更新。这说明本次更新没有使用预期的平均梯度。应先检查模型是否经过 DDP 包装，打印是否位于同步后的时间点，以及是否进入了 `no_sync()` 或其他改变同步行为的路径。

loss 不同本身不是故障证据；关键证据是梯度和权重符合“两份模型各自更新”的数值，而不是预期的 DDP 同步更新值。

</details>

## 10. 这次验证覆盖了什么，下一步看什么

下面把全文的五个关键问题再逐一对照。每题后都附有答案，也可以先合上答案自行复述。

### 问题一：两个 Python 进程怎样标识自己并加入同一个通信组？

<details>
<summary>查看答案：运行器与通信组</summary>

`--nproc-per-node=2` 让运行器启动两个独立进程，并设置各自的 `RANK`、`LOCAL_RANK` 和共同的 `WORLD_SIZE=2` 等环境变量。`--standalone --nnodes=1` 为本次单机任务准备会合信息。两个进程执行 `dist.init_process_group("gloo", ...)`，利用这些信息加入同一个默认通信组。

初始化后，`dist.get_rank()` 分别返回 `0` 和 `1`，`dist.get_world_size()` 都返回 `2`。可用脚本开头的打印核对。仅给两个普通 Python 进程手动写上编号，不能代替通信组初始化。

</details>

### 问题二：采样器怎样分配索引，DataLoader 怎样组成 batch？

<details>
<summary>查看答案：索引、输入值与本地 batch</summary>

本例不打乱，采样器按 `global_indices[rank::world_size]` 分配：rank 0 得到 `[0, 2, 4, 6]`，对应输入 `[1/8, 3/8, 5/8, 7/8]`；rank 1 得到 `[1, 3, 5, 7]`，对应输入 `[2/8, 4/8, 6/8, 8/8]`。

DataLoader 按本地索引顺序读取样本并分批。`batch_size=4` 时每个 rank 每轮只有一批，各更新一次；`batch_size=2` 时 rank 0 分为 `[0, 2]`、`[4, 6]`，rank 1 分为 `[1, 3]`、`[5, 7]`，各更新两次。本地 batch 大小不能直接当成所有进程合计的 batch 大小；原例一次同步更新合计使用 8 条样本。

</details>

### 问题三：为什么外层 epoch 循环不会自动改变采样顺序？

<details>
<summary>查看答案：把轮次传给采样器</summary>

Python 的 `epoch` 是训练循环中的局部变量，采样器不会自动读取它。`sampler.set_epoch(epoch)` 把轮次显式写入采样器；要在开始遍历本轮 DataLoader 之前调用。

`shuffle=False` 时，传不传轮次都保持原来的顺序。`shuffle=True` 时，PyTorch 2.5.1 使用 `seed + epoch` 生成全局排列；不调用 `set_epoch()` 就一直使用默认 epoch `0`，每轮重复同一排列。所有 rank 必须使用相同的 seed 和 epoch，才能从同一排列中正确划分任务。第 9 节的四种配置可以验证这些区别。

</details>

### 问题四：为什么本地 loss 可以不同，梯度和参数却相同？

<details>
<summary>查看答案：本地计算、梯度同步与参数更新</summary>

两个 rank 读取不同的样本，所以初始本地 loss 分别为 `1.312500` 和 `1.875000`，本地梯度分别为 `-1.312500` 和 `-1.875000`。默认 DDP 在反向传播中同步梯度，`backward()` 返回后，两边的 `.grad` 都是平均值 `-1.593750`。本例两个本地 batch 等大且都使用 mean loss，因此它也等于全部 8 条样本的平均梯度。

DDP 初始化时同步模型状态。之后两个进程从相同参数出发，使用相同的梯度、优化器配置与状态，执行相同更新，就都得到首步权重 `0.159375`。这里保持参数一致依靠的是一致的更新过程；DDP 没有在每步更新后再替两份参数做平均。loss 是本地日志指标，不会因梯度同步而自动变成同一个值。

</details>

### 问题五：all_gather 为什么能发现差异，却不能让参数保持一致？

<details>
<summary>查看答案：收集权重只用于检查</summary>

`dist.all_gather(replicas, weight)` 将各 rank 提交的权重按 rank 顺序收集到每个进程的 `replicas` 中。随后计算 `gap`，才能判断副本之间有没有差异。收集操作不平均权重、不改写模型，也不负责本例的梯度同步。

因此，删掉这段收集和比较逻辑，训练的首步梯度、首步权重和第五步权重仍应分别为 `-1.593750`、`0.159375` 和约 `0.679597`，但程序不再检查副本是否相等。保留它时，所有 rank 都要按匹配顺序参与通信，即使只有 rank 0 打印结果。第 9 节的第二个验证给出了删除范围及日志调整方法。

</details>

本次使用 CPU 和 Gloo，验证的是数据划分、梯度同步和参数更新的正确性。这些日志没有提供 NCCL 带宽、GPU 利用率或多卡加速比的证据。

下一篇先继续验证 DDP 的 batch、梯度累积和指标统计，再进入 NCCL 的集合通信与性能诊断。此后学习 Ray 调度、DeepSpeed 显存分片、Megatron-Core 并行，以及 TensorRT-LLM 和 NVIDIA Triton Inference Server 部署时，都可以回到这份小例子，分清“谁处理数据、谁同步什么、在哪里发生更新”。

### 官方文档索引

本文安装命令和 API 说明于 2026 年 10 月 2 日核对。采样器实现链接固定到 `v2.5.1`；`stable` 文档会随 PyTorch 发布更新，复验时请同时记录自己的版本。

- [PyTorch 历史版本与 CPU 安装命令](https://pytorch.org/get-started/previous-versions/)
- [torchrun 启动参数与环境变量](https://docs.pytorch.org/docs/stable/elastic/run.html)
- [DataLoader 与 DistributedSampler](https://docs.pytorch.org/docs/stable/data.html)
- [DistributedSampler：v2.5.1 源码](https://github.com/pytorch/pytorch/blob/v2.5.1/torch/utils/data/distributed.py)
- [DDP 设计说明](https://docs.pytorch.org/docs/stable/notes/ddp.html)
- [DistributedDataParallel API](https://docs.pytorch.org/docs/stable/generated/torch.nn.parallel.DistributedDataParallel.html)
- [集合通信与 all_gather API](https://docs.pytorch.org/docs/stable/distributed.html)
