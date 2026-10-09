---
title: '训练与推理入门（三）：DDP 的全局 loss 该怎么算'
description: '区分梯度同步与指标同步，用有效样本数加权汇总 loss，复现平均各 rank 均值造成的统计错误。'
pubDate: '2026-10-09'
tags: ['PyTorch', 'DDP', '分布式训练', '训练与推理']
category: '训练与推理'
series: '训练与推理入门'
seriesOrder: 3
draft: false
heroImage: '../../assets/images/cover-communication.svg'
---

第一篇中两个 rank 的权重相同，loss 却不同。这是因为它们读取了不同样本。DDP 同步梯度，并不会自动把当前进程的 `loss.item()` 改成全局平均值。

这篇约 18 分钟，验证一件直接影响监控和模型评测的事：各 rank 的有效样本数不同时，日志里的全局 loss 应该怎样汇总。

## 1. 全局均值要先求总和，再除以总数量

第 $r$ 个 rank 的损失总和为 $S_r$，有效样本数为 $N_r$，则：

$$
L_{\text{global}}=\frac{\sum_r S_r}{\sum_r N_r}
$$

“各 rank 平均 loss 的平均”通常不等于这个结果。各 rank 数量相同是一个保证它们相等的条件；数量不同时也可能碰巧相等，但不能依赖巧合。

统计单位必须与 loss 定义一致。这个例子每个样本只有一个标量输出，因此元素数就是样本数。语言模型按有效 token 求平均时，分母应该是未被 mask 的 token 数；不能直接拿 batch 内的序列数来代替。

工程意义很具体：错误汇总会让验证指标随着分片方式变化，误导收敛判断、模型选择和告警阈值。

## 2. 场景题：少量难样本被放大了多少

一次验证得到：

| rank | 有效样本数 | 损失总和 | 本地均值 |
| --- | ---: | ---: | ---: |
| 0 | 100 | 80 | 0.8 |
| 1 | 20 | 40 | 2.0 |

先计算三个值：只记录 rank 0；平均两个本地均值；对总和与数量分别归约后求平均。应该归约哪些量？两个 rank 权重完全相同，能否证明统计正确？答案见练习之后。

## 3. 完整练习：三种统计方法放在一起

本文使用 Linux／WSL、Python 3.10–3.12 和 PyTorch 2.5.1 CPU 基线。已有能运行第一篇的环境可以继续使用。两个进程都在本机 CPU 上运行，无需多张 GPU，不访问 Kubernetes 集群。CPU／Gloo 可以验证这里的通信与数值行为，不能验证 NCCL、GPU 显存或多卡带宽。

```bash
# 已有环境只需激活；没有环境时先创建。
python3 -m venv .venv-ddp
source .venv-ddp/bin/activate
python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
python -c 'import torch; print(torch.__version__)'
```

固定版本是为了复验，不代表最新版本。安装命令可对照 [PyTorch 历史版本页](https://pytorch.org/get-started/previous-versions/)。示例仅使用 PyTorch 张量，不依赖 NumPy 做计算。

保存为 `ddp_lesson03.py`，也可以[下载完整脚本](/lessons/ddp_lesson03.py)。

```python
from datetime import timedelta

import torch
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP


def main():
    dist.init_process_group("gloo", timeout=timedelta(seconds=60))
    try:
        rank = dist.get_rank()
        world_size = dist.get_world_size()
        assert world_size == 2, "Run this exercise with exactly two workers."

        model = torch.nn.Linear(1, 1, bias=False)
        with torch.no_grad():
            model.weight.zero_()
        model = DDP(model)

        # Rank 0 has 3 valid samples, each with squared error 1.
        # Rank 1 has 1 valid sample with squared error 9.
        if rank == 0:
            x = torch.zeros(3, 1)
            target = torch.ones(3, 1)
        else:
            x = torch.zeros(1, 1)
            target = torch.full((1, 1), 3.0)

        squared_errors = (model(x) - target).square()
        local_sum = squared_errors.sum(dtype=torch.float64)
        local_count = torch.tensor(
            squared_errors.numel(), dtype=torch.float64
        )
        local_mean = local_sum / local_count

        # Wrong when ranks have different valid-sample counts.
        naive_mean = local_mean.detach().clone()
        dist.all_reduce(naive_mean, op=dist.ReduceOp.SUM)
        naive_mean /= world_size

        # Correct: reduce the numerator and denominator separately.
        totals = torch.stack((local_sum.detach(), local_count))
        dist.all_reduce(totals, op=dist.ReduceOp.SUM)
        global_mean = totals[0] / totals[1]

        local_stats = torch.stack(
            (local_sum.detach(), local_count, local_mean.detach())
        )
        gathered = [torch.zeros_like(local_stats) for _ in range(world_size)]
        dist.all_gather(gathered, local_stats)

        print(
            f"rank={rank} local_sum={local_sum.item():.1f} "
            f"count={int(local_count.item())} "
            f"local_mean={local_mean.item():.1f}",
            flush=True,
        )

        if rank == 0:
            for worker, stats in enumerate(gathered):
                print(
                    f"gathered rank={worker}: sum={stats[0].item():.1f}, "
                    f"count={int(stats[1].item())}, "
                    f"mean={stats[2].item():.1f}"
                )
            print(f"rank0_only={gathered[0][2].item():.1f}")
            print(f"mean_of_rank_means={naive_mean.item():.1f}")
            print(f"weighted_global_mean={global_mean.item():.1f}")

        assert abs(naive_mean.item() - 5.0) < 1e-12
        assert abs(global_mean.item() - 3.0) < 1e-12
        if rank == 0:
            print("PASS: global loss = total loss sum / total valid count.")
    finally:
        dist.destroy_process_group()


if __name__ == "__main__":
    main()
```

模型初始化为零，输入也为零，因此预测为零。rank 0 的三个标签均为 1，三个平方误差均为 1；rank 1 的唯一标签为 3，平方误差为 9。这里故意使用不同本地样本数，且只做指标计算，不进行 backward 或 optimizer.step。

```bash
OMP_NUM_THREADS=1 python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 ddp_lesson03.py
```

验收标准：`rank0_only=1.0`，`mean_of_rank_means=5.0`，`weighted_global_mean=3.0`，最后打印 `PASS`。

`totals` 的两个元素分别是损失总和与有效数量。一次 `all_reduce(SUM)` 按元素求和，所有 rank 都得到同一份归约结果。`detach()` 将日志统计与训练计算图分开；这条指标通信不会自动修改训练梯度。

## 4. 参考答案：按哪个数量加权

<details>
<summary>查看答案：场景题的三个结果</summary>

只记录 rank 0 为 0.8。平均两个本地均值为 $(0.8+2.0)/2=1.4$。正确结果为：

$$
\frac{80+40}{100+20}=1.0
$$

应归约 loss_sum 与 valid_count，然后相除。rank 1 只有六分之一的样本，平均 rank 均值却给了它一半权重。

权重一致只反映模型副本一致，不能证明指标统计正确。

</details>

<details>
<summary>查看答案：脚本为何分别得到 1、5 和 3</summary>

rank 0 的均值是 $3/3=1$，rank 1 是 $9/1=9$，所以 rank 均值的平均为 $(1+9)/2=5$。

正确全局均值是 $(3+9)/(3+1)=3$。预期日志：

```text
rank=0 local_sum=3.0 count=3 local_mean=1.0
rank=1 local_sum=9.0 count=1 local_mean=9.0
rank0_only=1.0
mean_of_rank_means=5.0
weighted_global_mean=3.0
PASS: global loss = total loss sum / total valid count.
```

rank 输出的先后顺序可以变化；数值和断言才是验收依据。

</details>

## 5. 如何放进真实训练与验证代码

每个窗口可以累加 detached 的 loss_sum 和 valid_count，在所有 rank 都到达的同一个统计点统一归约，再由 rank 0 输出。不要只把通信放在 rank 0 的日志分支里；下一篇会专门验证这个问题。

按 token 统计时，一个基本形式是：

```python
local_sum = token_losses.detach().masked_select(valid_mask).sum()
local_count = valid_mask.sum()
```

前提是 `token_losses` 已经是逐 token 损失，mask 为相同形状的布尔张量。全局有效数量为 0 时应明确跳过或报告无有效数据，不能直接除以零。

本篇只修正日志。用于 backward 的本地 mean loss 若采用不同有效数量，DDP 默认按 rank 平均梯度，也未必等于按全体样本平均的梯度。不能把 detached 的日志归约误认为解决了训练权重问题。

## 6. 采样器补齐与验证集口径

`DistributedSampler(drop_last=False)` 为让索引数可整除副本数，可能重复一些索引；`drop_last=True` 会移除尾部。加权归约能正确计算“实际处理的记录”的均值，但不能自动消除补齐的重复样本。

评估原始验证集时，还要确认每条样本是否恰好计算一次。这与 padding token、过滤样本产生的有效计数问题是不同的检查。

资料核对日期：2026-10-09。参考 [all_reduce 官方文档](https://docs.pytorch.org/docs/stable/distributed.html#torch.distributed.all_reduce)、[DistributedSampler 文档](https://docs.pytorch.org/docs/stable/data.html#torch.utils.data.distributed.DistributedSampler)。

上一篇：[梯度累积与有效全局 batch](/blog/ddp-gradient-accumulation/)  
下一篇：[集合通信错位与卡住诊断](/blog/ddp-collective-hang-diagnosis/)

