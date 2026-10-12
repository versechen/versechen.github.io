---
title: '训练与推理入门（五）：测量 AllReduce，定位 NCCL 通信瓶颈'
description: '从 CPU 双进程练习到 GPU/NCCL 性能基线，解释通信计时、有效吞吐量、最慢 rank 和 Socket 路径，给出完整代码与排查顺序。'
pubDate: '2026-10-13'
tags: ['PyTorch', 'NCCL', '分布式训练', '训练与推理']
category: '训练与推理'
series: '训练与推理入门'
seriesOrder: 5
draft: false
heroImage: '../../assets/images/cover-nccl.svg'
---

前四篇解决的是“结果对不对”：数据有没有分开，梯度是否一致，全局 loss 是否算对，集合通信为什么会卡住。这次换一个问题：通信能完成，数值也正确，但训练为什么还是慢？

排查这类问题，需要一份可以比较的通信基线。本文从一个可在 WSL 上运行的双进程例子开始，测量不同大小的 AllReduce，再说明怎样把这些数字用于真实 GPU 集群。预计练习时间约 20 分钟。

## 1. AllReduce 到底做了什么

假设两个 rank 分别持有：

```text
rank 0: [1, 2, 3]
rank 1: [3, 4, 5]
```

调用 `dist.all_reduce(x, op=dist.ReduceOp.SUM)` 后，两个 rank 的张量都变成：

```text
rank 0: [4, 6, 8]
rank 1: [4, 6, 8]
```

Reduce 指把各 rank 的对应元素归约为一个结果；All 指所有参与 rank 都拿到这个结果。SUM 是逐元素求和，通信会原地改写传入的张量。它不会把两个数组拼接起来；拼接收集是 AllGather 的语义。

DDP 用集合通信同步梯度。默认 DDP 的梯度同步具有跨 rank 平均的语义，而手写的 AllReduce(SUM) 只做求和，不能直接把两者当成完全相同的调用。不同 rank 的有效样本数不同时，还要结合 loss 的归约方式处理权重，见[第三篇：全局 loss](/blog/ddp-global-loss-metrics/)。

## 2. 小消息看延迟，大消息看传输效率

可以先用一个粗略模型理解耗时：

$$
T(S) \approx \alpha + \frac{S}{B_{\mathrm{effective}}}
$$

这里，S 是单个 rank 的张量字节数，α 代表启动、调度等固定开销，B 是这次集合通信的有效传输效率。真实 AllReduce 还取决于 rank 数、算法、协议和拓扑，这个式子只帮助区分两种现象：

| 现象 | 优先调查什么 |
| --- | --- |
| 4 KiB 这样的小张量也明显变慢 | 固定开销、进程调度、通信启动与等待 |
| 小张量变化不大，64 MiB 明显变慢 | 大消息吞吐、通信路径和资源争用 |
| 独立通信测试正常，完整训练变慢 | 数据加载、计算、梯度桶和通信重叠 |

训练的 step 时间还受到计算与通信重叠影响。DDP 可以在反向传播期间逐步归约梯度桶，部分通信被计算隐藏。真正拖慢训练的是关键路径上暴露出的等待。不能把独立 AllReduce 时间直接乘以调用次数，就认定这一定是训练的通信开销。

GPU 利用率高也不能证明训练高效：通信内核也会占用 GPU。需要把独立基准和训练时间线放在一起看。

## 3. 场景题：两台机器的 8 卡训练慢了

以下是教学用假设数据，未对应任何实际集群测量。

两台服务器，每台 4 张 GPU，8 个进程各使用一张卡。原本预期通过 InfiniBand 跨节点通信。一次部署后训练吞吐下降约 35%，采集到：

| 项目 | 当前结果 |
| --- | --- |
| 4 KiB AllReduce | 35 μs |
| 4 MiB AllReduce | 0.5 ms |
| 64 MiB AllReduce | 8 ms |
| 此前同规模 64 MiB AllReduce | 2.5 ms |
| 各 rank 计算耗时 | 基本不变 |
| 通信状态 | 最终完成，没有明显假死 |
| NCCL 日志 | 出现 NET/Socket |

先想三个问题：优先调查正确性还是性能？NET/Socket 能否直接证明 IB 失效？第一轮应该收集哪些证据？

答案放在练习之后。注意，这张表没有提供此前的小消息耗时，因此不能断言“小消息延迟稳定”。

## 4. 先在 CPU 上跑，再到多卡环境验证

| 模式 | 资源要求 | 能验证什么 |
| --- | --- | --- |
| CPU/Gloo | 本机 CPU，两个 Python 进程 | AllReduce 语义、计时流程、结果校验 |
| GPU/NCCL | Linux CUDA 环境，至少两张可用 GPU | GPU 集合通信及该环境下的性能 |
| 多节点 GPU/NCCL | 多台 GPU 服务器及互通网络 | 跨节点路径与网络性能 |

CPU/Gloo 的成功不代表 NCCL、NVLink 或 RDMA 已验证。单机两卡测试也不能验证两台服务器之间的 InfiniBand。单张 A2000 可以先完成 Gloo 练习，但不要让两个 NCCL rank 共享同一张 GPU来替代双卡测试。

已有前几课的环境可以继续使用，不必为了本课更换 PyTorch。程序使用 Python 3.10+ 与 PyTorch 2.x 的常用分布式 API，不使用 NumPy。先检查：

```bash
python - <<'PY'
import torch
import torch.distributed as dist

print("PyTorch:", torch.__version__)
print("CUDA available:", torch.cuda.is_available())
print("Visible GPU count:", torch.cuda.device_count())
print("Gloo available:", dist.is_gloo_available())
print("NCCL available:", dist.is_nccl_available())
PY
```

NCCL 模式需要 CUDA 版 PyTorch 和兼容的驱动、运行库。不要因为 CPU 版本没有 NCCL 就认定安装损坏。

## 5. 完整程序：四种大小的 AllReduce

保存为 `nccl_lesson05.py`，也可以[下载完整脚本](/lessons/nccl_lesson05.py)。

```python
import argparse
import os
import time
from datetime import timedelta

import torch
import torch.distributed as dist


def synchronize(device):
    if device.type == "cuda":
        torch.cuda.synchronize(device)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("gloo", "nccl"), default="gloo")
    parser.add_argument("--iters", type=int, default=20)
    args = parser.parse_args()
    if args.iters < 1:
        raise ValueError("--iters must be >= 1")

    if args.backend == "nccl":
        if not dist.is_nccl_available() or not torch.cuda.is_available():
            raise RuntimeError("NCCL mode requires NCCL and CUDA")
        local_rank = int(os.environ["LOCAL_RANK"])
        local_world_size = int(os.environ["LOCAL_WORLD_SIZE"])
        if torch.cuda.device_count() < local_world_size:
            raise RuntimeError("Each local process needs a distinct visible GPU")
        torch.cuda.set_device(local_rank)
        device = torch.device("cuda", local_rank)
    else:
        device = torch.device("cpu")

    dist.init_process_group(backend=args.backend, timeout=timedelta(seconds=120))
    try:
        rank = dist.get_rank()
        world_size = dist.get_world_size()
        if world_size < 2:
            raise ValueError("Run with at least two workers")
        expected = world_size * (world_size + 1) / 2
        print(f"rank={rank}, world_size={world_size}, "
              f"backend={args.backend}, device={device}", flush=True)

        for nbytes in (4 * 1024, 256 * 1024, 4 * 1024**2, 64 * 1024**2):
            x = torch.empty(nbytes // 4, dtype=torch.float32, device=device)

            def one_iteration():
                x.fill_(rank + 1)
                synchronize(device)
                start = time.perf_counter()
                dist.all_reduce(x, op=dist.ReduceOp.SUM)
                synchronize(device)
                return (time.perf_counter() - start) * 1000

            for _ in range(3):
                one_iteration()
            dist.barrier()
            synchronize(device)
            samples = [one_iteration() for _ in range(args.iters)]

            # Full-tensor validation happens outside the timed region.
            local_ok = torch.all(torch.abs(x - expected) <= 1e-5).item()
            ok = torch.tensor([int(local_ok)], dtype=torch.int32, device=device)
            dist.all_reduce(ok, op=dist.ReduceOp.MIN)
            if ok.item() != 1:
                raise AssertionError("AllReduce result mismatch on at least one rank")

            # MAX of rank means, not mean of per-iteration rank maxima.
            elapsed = torch.tensor([sum(samples) / len(samples)],
                                   dtype=torch.float64, device=device)
            dist.all_reduce(elapsed, op=dist.ReduceOp.MAX)
            if rank == 0:
                avg_ms = elapsed.item()
                payload_gbps = nbytes / (avg_ms / 1000) / 1e9
                print(f"bytes={nbytes:>8}, slowest_rank_avg_ms={avg_ms:.4f}, "
                      f"payload_GBps={payload_gbps:.4f}, check=PASS", flush=True)
    finally:
        dist.destroy_process_group()


if __name__ == "__main__":
    main()
```

四种大小为 4 KiB、256 KiB、4 MiB 和 64 MiB。float32 每个元素占 4 字节，所以元素数是 `nbytes // 4`。输出 bytes 指每个 rank 的张量大小，不是整个集群的总流量。

每次迭代都重新填充输入：rank 0 全为 1，rank 1 全为 2。双进程求和后，每个元素都应为 3。若不重新填充，下一次就会把上一次的结果再次求和，双进程会从 3 变成 6、再变成 12，校验目标也就变了。

初始化设置了 120 秒操作超时，用于给本练习提供有限等待；它不是生产环境的通用超时建议。所有 rank 要使用相同的 backend、iters 和通信顺序。

### 5.1 CPU/Gloo 双进程

```bash
OMP_NUM_THREADS=1 \
python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 \
  nccl_lesson05.py --backend gloo --iters 20
```

`torchrun` 提供 RANK、WORLD_SIZE 等环境变量。这里 world_size=2，两个进程都在 CPU 上工作。只有 rank 0 输出汇总行，但通信和校验由所有 rank 共同参与。

输出格式如下，尖括号是占位符，未填入任何假装实测的性能数字：

```text
rank=0, world_size=2, backend=gloo, device=cpu
rank=1, world_size=2, backend=gloo, device=cpu
bytes=    4096, slowest_rank_avg_ms=<测量值>, payload_GBps=<测量值>, check=PASS
bytes=  262144, slowest_rank_avg_ms=<测量值>, payload_GBps=<测量值>, check=PASS
bytes= 4194304, slowest_rank_avg_ms=<测量值>, payload_GBps=<测量值>, check=PASS
bytes=67108864, slowest_rank_avg_ms=<测量值>, payload_GBps=<测量值>, check=PASS
```

### 5.2 两张 GPU/NCCL

确认至少两张可用 GPU，每个本地进程独占一张卡，再运行：

```bash
NCCL_DEBUG=INFO \
NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH,TUNING \
OMP_NUM_THREADS=1 \
python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 \
  nccl_lesson05.py --backend nccl --iters 20
```

LOCAL_RANK 是本机进程序号；在这里它对应可见 CUDA 设备的索引。程序先 `set_device(local_rank)`，再初始化进程组。若通过 CUDA_VISIBLE_DEVICES 筛选了物理卡，cuda:0 指筛选后的第一张可见卡。

这条命令是**单机双卡**。场景题中的两机 8 卡需要每台服务器启动 4 个进程，通过同一个 rendezvous 汇合，world_size 应为 8；不能把上面命令在两台机器分别执行，就当成同一个跨节点任务。

日志用于检查初始化与路径。建立正式基线时，再关闭 INFO 调试日志做重复测量；不要在启用 TORCH_DISTRIBUTED_DEBUG=DETAIL 的运行和关闭它的运行之间直接比较性能。

### 5.3 验收

两个不同 rank、world_size=2、四行 check=PASS，以及正数耗时和吞吐量，构成双进程练习的基本验收。PASS 表示最后一次迭代的完整张量在所有 rank 上通过校验，不表示每一次迭代都做了数值扫描，也不表示性能达到某个硬件标准。

本次文章整理时，脚本已通过 Python 语法检查。发布环境没有安装 PyTorch，也没有可用多 GPU，因此没有完成 Gloo 或 NCCL 实测。本文不给出实测性能结论；请在目标环境运行并保存结果。

## 6. 怎样读计时和吞吐量

### 6.1 为什么 GPU 前后都要同步

GPU 操作通常通过 CUDA stream 排队。Python 调用返回，并不意味着 GPU 已经执行完。

计时前同步，是让输入填充等已提交工作完成；计时后同步，是等待 AllReduce 真正执行结束。否则只量到了 CPU 提交工作的部分时间，数字可能远小于实际耗时。

这份程序测量的是主机观察到的操作完成耗时，包含 Python 调用、后端提交、等待与同步开销。它不是纯链路传输时间，也不是 CUDA Event 测得的单个内核执行时间。

每次填充和校验不在计时区间内。预热三次也不计入统计。预热后的 barrier 用于协调各 rank 到达测量阶段，但迭代内部没有逐次 barrier；某个 rank 进入得晚，其他 rank 的通信耗时会包含等它的时间。因此调度抖动也是这份端到端测量的一部分。

### 6.2 MAX 汇总的到底是什么

先对每个 rank 的多次样本求均值，再对这些均值执行 MAX：

$$
T_{\mathrm{reported}} = \max_r \left(\frac{1}{K}\sum_{i=1}^{K}T_{r,i}\right)
$$

例如四个 rank 的平均耗时是 1.0、1.2、1.1、5.0 ms，最终报告 5.0 ms，可以避免只看 rank 0 而漏掉长期偏慢的进程。

但它不是“每次迭代取最慢 rank，再对迭代求平均”。若慢 rank 在不同迭代轮换，两者会不同。当前程序也没有输出最慢 rank 的身份、P95/P99 或训练 step 的关键路径。需要长尾分析时，应收集各 rank 的逐次样本，再对齐迭代编号。

### 6.3 payload_GBps 不等于网卡带宽

本文定义：

$$
\mathrm{payload\_GBps} = \frac{\text{单个张量字节数}}{T_{\mathrm{reported}}\text{（秒）}} \div 10^9
$$

GB/s 使用十进制；输入大小的 KiB、MiB 使用二进制。GB/s 是字节每秒，网卡标称 Gb/s 是比特每秒，两者相差 8 倍。

NVIDIA nccl-tests 的 algbw 同样采用大小除以时间的基本形式，但计时方式和测试配置不同，不能直接认定两份程序的数值应一致。对 AllReduce，nccl-tests 的 busbw 还使用 rank 数修正：

$$
\mathrm{busbw} = \mathrm{algbw}\times\frac{2(N-1)}{N}
$$

这是集合通信性能的归一化估计，不能当作每一根物理链路上的实测流量。尤其是异构、分层或多网卡拓扑，要结合实际通信路径解读。

## 7. 场景题答案：从证据缩小范围

<details>
<summary>查看答案：当前优先调查什么？</summary>

64 MiB 从 2.5 ms 增至 8 ms，计算耗时基本不变，优先检查通信性能与路径变化。通信最终能完成，使“缺少某个 collective 参与者”这类故障的优先级下降，但并未证明全部结果正确；还需要数值校验。

该消息大小下，大小除以时间的有效吞吐约从 26.84 GB/s 降到 8.39 GB/s。这个比值描述通信基线下降，不能直接解释训练吞吐为何恰好下降 35%。训练还有通信重叠、不同消息大小和其他等待。

没有历史小消息数据，不能据此断言只有大消息受到影响。应在相同配置下重新测量完整的大小区间。

</details>

<details>
<summary>查看答案：出现 NET/Socket 就说明 IB 坏了吗？</summary>

不够。要区分用于发现和建立连接的 bootstrap 网络，以及真正传输 collective 数据的网络路径。看到 bootstrap 使用 IP/Socket 很常见，并不意味着 AllReduce 的数据一定走 TCP。

即便日志显示 Socket 网络后端可用或被选择，也要结合各 channel 的连接信息，确认这次跨节点数据使用了哪条路径。某些网络插件还会有自己的名称。

若完整日志明确显示跨节点数据使用 Socket，而此前同配置使用 IB/RDMA，再去查设备发现、RDMA 库、容器设备权限、接口选择和环境变量差异。NCCL 的内置 IB 后端也能用于 RoCE，因此 NET/IB 名称不等于物理网络一定是原生 InfiniBand。

“预期 IB，实际 Socket”是值得调查的差异；根因仍需要后续证据。

</details>

<details>
<summary>查看答案：第一轮收集哪些证据？</summary>

第一类是全部 rank 的 NCCL 日志和运行配置，包括 PyTorch/CUDA/NCCL 版本、GPU 绑定、启动命令与 NCCL 环境变量。日志应能区分 bootstrap、设备发现和 channel 的数据连接。

第二类是拓扑和设备状态。用 nvidia-smi topo -m 查看 GPU/GPU 与 GPU/NIC 的距离；用 ibv_devices、ibv_devinfo、ibstat 查看 RDMA 设备和链路。命令需要相应工具包；设备存在也不代表数据已通过它传输。容器内可见设备与宿主机状态都要核对。

第三类是独立通信基线：每台机器先做单机多卡，再做两机同规模测试，并与部署前记录比较。同机正常、跨机异常时，跨节点路径更值得关注；独立测试都正常时，回到完整训练调查通信重叠、梯度桶、数据读取与慢 rank。

</details>

常用只读检查：

```bash
nvidia-smi
nvidia-smi topo -m
ibv_devices
ibv_devinfo
ibstat
```

不要一上来同时改 NCCL_IB_DISABLE、NCCL_SOCKET_IFNAME、NCCL_IB_HCA 等多个参数。先记录当前值，确认路径，再每次改变一项并复测。接口名需来自目标机器，不能照抄别人的 mlx5_0 或 eth0。

## 8. 用 nccl-tests 建立正式基线

本文的 Python 程序适合学习语义与测量方法。要做 GPU 集群验收，继续使用 [NVIDIA nccl-tests](https://github.com/NVIDIA/nccl-tests)，它提供独立的正确性和性能测试。

在已按官方 README 构建好的目录里，单机双卡可以运行：

```bash
./build/all_reduce_perf -b 4K -e 64M -f 2 -g 2
```

这是一个进程使用两张 GPU 的 nccl-tests 模式，与本文 torchrun 启动两个进程的方式不同。两个模式都可以测试双卡通信，但不能把两套进程参数混在一起。跨节点测试需要支持 MPI 的构建和多节点启动方式，按实际集群的 MPI、GPU 数和网络配置执行。

固定 GPU 型号、卡数、节点数、消息大小、dtype、软件版本和负载条件，多次运行并保存日志。单机不同 GPU 配对也可能存在性能差异：同一个 NVLink 域与跨 CPU 插槽的 PCIe 路径，不是等价的通信条件。

记录表可以从这些字段开始：

| 字段 | 记录内容 |
| --- | --- |
| 配置 | GPU 型号、可见设备、rank 数、节点数、dtype |
| 软件 | 驱动、PyTorch、CUDA、NCCL 和测试程序版本 |
| 拓扑 | GPU/NIC 距离、NVLink/PCIe、RDMA 设备与端口 |
| 条件 | 调试开关、共享负载、预热与迭代次数 |
| 结果 | 大小、耗时、algbw/busbw 或本文 payload_GBps |
| 校验 | 错误数、完整日志、对照基线 |

这些记录让“比以前慢了”变成可以复验的问题。没有固定条件的两个吞吐量数字，比较价值有限。

## 9. 本课完成标准与后续

- 能解释 AllReduce(SUM) 的逐元素结果。
- 双进程 Gloo 四种大小都输出 PASS。
- 能解释 GPU 计时前后同步的作用。
- 能区分最慢 rank 的平均耗时、逐轮最大耗时与长尾延迟。
- 能区分 payload_GBps、algbw、busbw 和物理带宽。
- 能判断单机测试的范围，并列出跨节点排查所需的证据。

只运行 Gloo，可以完成集合通信与基准测量方法练习；NCCL 多卡性能验证仍需要目标硬件。下一课继续分析 PCIe、NVLink、GPU/NIC 距离，以及怎样区分机内瓶颈和跨节点瓶颈。

上一篇：[集合通信错位与卡住诊断](/blog/ddp-collective-hang-diagnosis/)

## 参考资料

资料核对日期：2026-10-13。文档随版本变化，实际排查以运行环境对应版本为准。

- [PyTorch 分布式通信文档](https://docs.pytorch.org/docs/stable/distributed.html)：后端选择、AllReduce 与 CUDA 异步语义。
- [PyTorch DDP 设计说明](https://docs.pytorch.org/docs/stable/notes/ddp.html)：梯度桶和通信重叠。
- [NCCL 环境变量](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)：调试子系统与接口选择。
- [NCCL 故障排查](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html)：拓扑、网络和运行环境。
- [nccl-tests 性能指标](https://github.com/NVIDIA/nccl-tests/blob/master/doc/PERFORMANCE.md)：algbw 和 busbw 的定义。
