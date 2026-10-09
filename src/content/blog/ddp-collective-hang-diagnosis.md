---
title: '训练与推理入门（四）：集合通信错位与卡住诊断'
description: '用有超时保护的 CPU 双进程例子复现 rank 缺席，解释 collective 顺序、日志分支与调试开关。'
pubDate: '2026-10-09'
tags: ['PyTorch', 'DDP', '分布式训练', '训练与推理']
category: '训练与推理'
series: '训练与推理入门'
seriesOrder: 4
draft: false
heroImage: '../../assets/images/cover-music.svg'
---

第三篇的 loss 汇总需要所有 rank 一起参与。若为了“只输出一份日志”，把 all_reduce 也放进 rank 0 分支，就会产生一个很容易误判成网络故障的问题。

这篇约 20 分钟，用正常和故障两个模式验证集合通信的参加规则。全部在本机 CPU 上运行，故障模式有超时保护。

## 1. 集合通信要匹配同一次约定

同一个进程组里的 collective 可以看作有序的共同操作。默认双进程组中的 all_reduce，需要两个 rank 都提交输入。参与成员、操作顺序和参数都必须符合约定。

对这里的 all_reduce，两个 rank 应使用相同 shape、dtype 和 SUM 操作。通信不是按 Python 变量名匹配的：不同 rank 把变量都命名为 loss，也不能弥补调用顺序不同。

| 通信序号 | rank 0 | rank 1 |
| --- | --- | --- |
| 1 | all_reduce | all_reduce |
| 2 | barrier | barrier |

只让 rank 0 写日志是合理的，但通信要在所有参与 rank 上执行：

```python
dist.all_reduce(loss)
if rank == 0:
    print(loss)
```

即便只有 rank 0 需要结果，改为 `dist.reduce(..., dst=0)` 后，组内所有 rank 仍要调用 reduce。dst 决定结果接收方，不代表只有它参加。

## 2. 场景题：次数一样，为什么仍然错

两个 rank 各有一个本地 mean loss，分别为 10 和 30，且各自有效样本数相同。希望记录全局均值 20。但调用顺序为：

| 次序 | rank 0 | rank 1 |
| --- | --- | --- |
| 1 | all_reduce(loss) | barrier() |
| 2 | barrier() | all_reduce(loss) |

请判断：次数相同是否足够？barrier 能否匹配 all_reduce？只在 rank 0 前面加 barrier 有用吗？正确汇总并只打印一份日志，代码应怎样写？答案见下文。

## 3. 完整练习：故意让一个 rank 缺席

本文使用 Linux／WSL、Python 3.10–3.12 和 PyTorch 2.5.1 CPU 基线。已有能运行第一篇的环境可以继续使用。两个进程都在本机 CPU 上运行，无需多张 GPU，不访问 Kubernetes 集群。CPU／Gloo 可以验证这里的通信与数值行为，不能验证 NCCL、GPU 显存或多卡带宽。

```bash
# 已有环境只需激活；没有环境时先创建。
python3 -m venv .venv-ddp
source .venv-ddp/bin/activate
python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
python -c 'import torch; print(torch.__version__)'
```

固定版本是为了复验，不代表最新版本。安装命令可对照 [PyTorch 历史版本页](https://pytorch.org/get-started/previous-versions/)。示例仅使用 PyTorch 张量，不依赖 NumPy 做计算。

保存为 `ddp_lesson04.py`，也可以[下载完整脚本](/lessons/ddp_lesson04.py)。

```python
import argparse
import time
from datetime import timedelta

import torch
import torch.distributed as dist


def short_error(exc):
    return str(exc).splitlines()[0][:240]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode", choices=("good", "rank0-only"), default="good"
    )
    args = parser.parse_args()

    dist.init_process_group(
        backend="gloo",
        timeout=timedelta(seconds=5),
    )
    assert dist.get_world_size() == 2, "Run with exactly two workers."
    rank = dist.get_rank()
    value = torch.tensor(float(rank + 1))
    expected_failure = False

    try:
        print(
            f"rank={rank} before collective value={value.item():.1f}",
            flush=True,
        )

        if args.mode == "rank0-only" and rank == 1:
            print("rank=1 BUG: skipped all_reduce", flush=True)
            time.sleep(7)
        else:
            # Correct rule: every rank in the process group calls this.
            dist.all_reduce(value, op=dist.ReduceOp.SUM)
            print(
                f"rank={rank} after collective value={value.item():.1f}",
                flush=True,
            )

    except RuntimeError as exc:
        if args.mode != "rank0-only":
            raise
        expected_failure = True
        print(
            f"rank={rank} EXPECTED_FAILURE: {short_error(exc)}",
            flush=True,
        )
    finally:
        dist.destroy_process_group()

    if args.mode == "good":
        assert value.item() == 3.0
        if rank == 0:
            print("PASS: both ranks joined; only rank 0 writes the log.")
    elif rank == 0:
        assert expected_failure
        print("PASS: missing collective participant was detected.")


if __name__ == "__main__":
    main()
```

脚本只有两个 rank：分别提交 1 和 2。正常模式两者一起执行 all_reduce，结果应为 3。故障模式 rank 1 明确跳过 all_reduce，并暂时保持进程存活，rank 0 等待超时。

初始化本身若失败，不算复现成功。故障模式只捕获初始化完成后的预期 RuntimeError，正常模式的异常照常抛出。

先运行正常模式：

```bash
OMP_NUM_THREADS=1 TORCH_CPP_LOG_LEVEL=INFO TORCH_DISTRIBUTED_DEBUG=DETAIL \
python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 ddp_lesson04.py --mode good
```

再运行故障模式：

```bash
OMP_NUM_THREADS=1 TORCH_CPP_LOG_LEVEL=INFO TORCH_DISTRIBUTED_DEBUG=DETAIL \
timeout --kill-after=5s 30s python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 ddp_lesson04.py --mode rank0-only
```

代码内的 Gloo 操作超时为 5 秒；外层 GNU timeout 为启动和清理留出时间，30 秒仍未退出时终止这次本地命令。5 秒是演示用配置，不是生产环境的推荐值。

验收：正常模式两个 rank 均打印 value=3.0 和成功日志；故障模式打印 rank 1 跳过通信、rank 0 EXPECTED_FAILURE，随后退出。异常原文随版本变化，不要求逐字相同。

## 4. 参考答案与日志点评

<details>
<summary>查看答案：次数、顺序与 barrier</summary>

次数相同不够。两个 rank 的第一个 collective 分别是 all_reduce 和 barrier，无法组成对应的一次操作。后面的顺序也错位了。可能表现为等待、超时，或在启用一致性检查时直接报错。

barrier 不能代替另一侧的 all_reduce。只有 rank 0 调用的 barrier 同样缺少 rank 1，只是将错误提前了。

正确代码：

```python
loss_sum = loss.detach().clone()
dist.all_reduce(loss_sum, op=dist.ReduceOp.SUM)
global_loss = loss_sum / dist.get_world_size()
if dist.get_rank() == 0:
    print(global_loss.item())
```

本题各 rank 的有效数量相同，因此可以平均本地均值。数量不同的情况仍应使用上一篇的 loss_sum／valid_count 方法。

</details>

<details>
<summary>查看答案：正常与故障模式应观察到什么</summary>

正常模式关键输出：

```text
rank=0 before collective value=1.0
rank=1 before collective value=2.0
rank=0 after collective value=3.0
rank=1 after collective value=3.0
PASS: both ranks joined; only rank 0 writes the log.
```

故障模式的关键事件：

```text
rank=1 BUG: skipped all_reduce
rank=0 EXPECTED_FAILURE: ...
PASS: missing collective participant was detected.
```

事件打印的先后可能变化。DETAIL 可能报告 monitoredBarrier 缺席，也可能看到操作超时或对端关闭连接；代码与日志明确显示 rank 1 没进入 collective，才构成这次演示的完整证据。只有一条 Timeout 并不能推断真实集群的根因。

捕获到故障后的 PASS 表示演示成功检测到了缺席，不表示通信成功。真实训练遇到通信异常应结束并重新启动任务，不要吞掉异常后继续使用已失败的进程组。

</details>

## 5. 在真实训练里从哪里检查

DDP 的 backward 也包含 collective，因此不同 rank 的控制流需要协调。一个 rank 因坏样本而跳过 backward、某个 rank OOM 后退出、只有部分 rank 做带通信的验证，都会让剩余进程停在等待点。即便外面没有手写 all_reduce，也可能发生。

定位时给每个 rank 记录 step、通信名和前后位置：

```python
print(f"rank={rank} step={step} before loss all_reduce", flush=True)
dist.all_reduce(tensor)
print(f"rank={rank} step={step} after loss all_reduce", flush=True)
```

如果只看到 before，检查其他 rank 是否更早异常、是否少走一个 batch、是否进入不同分支，以及 collective 的 shape、dtype、进程组是否对应。超时说明操作没及时完成，不一定说明报错的 rank 就是出问题的那个。

`TORCH_DISTRIBUTED_DEBUG=DETAIL` 会增加 collective 一致性检查，帮助发现类型、shape 或调用进度错位。它有调试开销，性能测量时应关闭。[monitored_barrier](https://docs.pytorch.org/docs/stable/distributed.html#torch.distributed.monitored_barrier) 还可以报告没有及时到达的 rank；这个接口需要 Gloo 进程组，NCCL 训练中不能直接把 NCCL 组传进去。

资料核对日期：2026-10-09。参考 [PyTorch 分布式调试说明](https://docs.pytorch.org/docs/stable/distributed.html#torch-distributed-debug)、[DDP 内部通信顺序](https://docs.pytorch.org/docs/stable/notes/ddp.html)。

上一篇：[正确统计全局 loss](/blog/ddp-global-loss-metrics/)  
下一课计划进入 NCCL：比较 all-reduce、all-gather、reduce-scatter 与 broadcast 的数据变化。CPU／Gloo 只能演示通信语义，NCCL 带宽需要实际多 GPU 环境验证。

