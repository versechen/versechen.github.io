---
title: '训练与推理入门（二）：梯度累积与有效全局 batch'
description: '用两个 CPU 进程对照大 batch 与梯度累积，验证 loss 缩放、no_sync 和参数更新；给出完整代码与折叠答案。'
pubDate: '2026-10-09'
tags: ['PyTorch', 'DDP', '分布式训练', '训练与推理']
category: '训练与推理'
series: '训练与推理入门'
seriesOrder: 2
draft: false
heroImage: '../../assets/images/cover-garden.svg'
---

第一篇用一个参数的小模型看清了 DDP 的梯度同步。这次继续用同一组可以手算的数据，验证另一个常见需求：一次装不下较大的 batch，拆成两次计算，怎样得到同一次参数更新？

本篇约 20 分钟。练习已经发布不等于已经完成；即使没有跑过前一节，也可以独立执行这里的脚本。

## 1. 先分清微批和一次更新

微批（microbatch）是一次前向、反向传播处理的数据。梯度累积则是在参数保持不变时，多次计算梯度，最后只更新一次参数。

当每个 rank 的微批大小为 $b$，数据并行进程数为 $D$，每个更新窗口累计 $K$ 次时：

$$
B_{\text{global}}=b\times D\times K
$$

这里要求各 rank 的微批等大、累计次数相同，且没有不足一批的尾部。比如两个 rank，每次各处理两条样本，累计两次后更新，使用的有效全局 batch 就是 8。

工程上，缩小微批通常可以减少一次前向保存的激活。它不会自动拆分模型参数或优化器状态，也不能保证吞吐更高。本例不测 GPU 显存或速度。

## 2. 为什么 loss 要除以累计次数

PyTorch 的多次 `backward()` 会把梯度加到参数的 `.grad` 上，而不是覆盖旧值。若每个微批的 loss 都是平均值，等大的两个微批需要各除以 2，才能把“两个均值的和”变成同一批样本的均值。

一个窗口的操作顺序是：

1. 开始时调用一次 `zero_grad()`。
2. 每个微批计算 `loss / K`，再 `backward()`。
3. 窗口结束时调用一次 `optimizer.step()`。

DDP 已经在各 rank 间平均梯度，所以这里不再额外除以 `world_size`。微批不等大、有效 token 数不同或有尾部窗口时，不能直接照搬固定的 `loss / K`；要按实际统计单位加权。

## 3. no_sync 到底省掉什么

默认 DDP 会在每次反向传播中同步梯度。梯度累积时，可以把前 $K-1$ 次的前向和反向放进 `model.no_sync()`，最后一次正常执行，让累计梯度一起同步。

```python
with model.no_sync():
    loss = loss_fn(model(x), y)
    (loss / K).backward()
```

前向也必须在上下文内。仅退出 `no_sync()` 不会发起同步；后续正常的前向、反向才完成它。它减少需要梯度同步的微批次数，但不代表模型里所有通信都消失，也不等于精确的底层 collective 调用数。可对照 [DDP 官方 no_sync 说明](https://docs.pytorch.org/docs/stable/generated/torch.nn.parallel.DistributedDataParallel.html#torch.nn.parallel.DistributedDataParallel.no_sync)。

## 4. 工程场景：副本一致，是否就算正确

两个 rank 处理一轮共 32 条样本，均分，没有补齐、丢弃或尾批。使用 mean MSE、学习率 0.1 的 SGD，初始权重为 0。

| 方案 | 每个 rank 一次前向的样本数 | 累计次数 |
| --- | ---: | ---: |
| A | 4 | 1 |
| B | 2 | 2 |

B 第一组更新的微批梯度，在除以累计次数之前如下：

| rank | 微批 1 | 微批 2 |
| --- | ---: | ---: |
| 0 | -0.3125 | -2.3125 |
| 1 | -0.6250 | -3.1250 |

先预测：有效全局 batch 各是多少？每个 rank 一轮分别反向多少次、更新多少次？忘记除以 2 后第一次权重是多少？副本权重相同能否排除这个错误？答案放在运行练习之后。

## 5. 完整练习：与一次大 batch 更新对照

本文使用 Linux／WSL、Python 3.10–3.12 和 PyTorch 2.5.1 CPU 基线。已有能运行第一篇的环境可以继续使用。两个进程都在本机 CPU 上运行，无需多张 GPU，不访问 Kubernetes 集群。CPU／Gloo 可以验证这里的通信与数值行为，不能验证 NCCL、GPU 显存或多卡带宽。

```bash
# 已有环境只需激活；没有环境时先创建。
python3 -m venv .venv-ddp
source .venv-ddp/bin/activate
python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
python -c 'import torch; print(torch.__version__)'
```

固定版本是为了复验，不代表最新版本。安装命令可对照 [PyTorch 历史版本页](https://pytorch.org/get-started/previous-versions/)。示例仅使用 PyTorch 张量，不依赖 NumPy 做计算。

保存为 `ddp_lesson02.py`，也可以[下载完整脚本](/lessons/ddp_lesson02.py)。

```python
import argparse
from contextlib import nullcontext
from datetime import timedelta

import torch
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader, DistributedSampler, TensorDataset


def new_model():
    model = torch.nn.Linear(1, 1, bias=False)
    with torch.no_grad():
        model.weight.zero_()
    return DDP(model)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bad-scale", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(1)
    dist.init_process_group("gloo", timeout=timedelta(seconds=60))
    try:
        rank, world = dist.get_rank(), dist.get_world_size()
        assert world == 2, "Run with exactly two workers."
        x = (torch.arange(1, 9, dtype=torch.float32) / 8).repeat(4)
        x = x.reshape(-1, 1)
        dataset = TensorDataset(x, 2 * x)
        sampler = DistributedSampler(dataset, shuffle=False)
        loader = DataLoader(dataset, batch_size=4, sampler=sampler)
        big, accum = new_model(), new_model()
        big_opt = torch.optim.SGD(big.parameters(), lr=0.1)
        accum_opt = torch.optim.SGD(accum.parameters(), lr=0.1)
        updates = 0

        for xb, yb in loader:
            # A: Each rank processes four samples in one backward pass.
            big_opt.zero_grad(set_to_none=True)
            (big(xb) - yb).square().mean().backward()
            big_grad = big.module.weight.grad.item()
            big_opt.step()

            # B: The same four samples become two microbatches of two.
            accum_opt.zero_grad(set_to_none=True)
            for micro, (mx, my) in enumerate(zip(xb.chunk(2), yb.chunk(2))):
                context = accum.no_sync() if micro == 0 else nullcontext()
                with context:  # Include BOTH forward and backward.
                    loss = (accum(mx) - my).square().mean()
                    (loss / (1 if args.bad_scale else 2)).backward()
                if updates == 0 and micro == 0:
                    print(f"rank={rank} unsynced_grad="
                          f"{accum.module.weight.grad.item():.6f}", flush=True)

            accum_grad = accum.module.weight.grad.item()
            accum_opt.step()
            weight = accum.module.weight.detach().flatten().clone()
            replicas = [torch.zeros_like(weight) for _ in range(world)]
            dist.all_gather(replicas, weight)  # Diagnostic only.
            replica_gap = (torch.stack(replicas) - replicas[0]).abs().max().item()
            reference_gap = abs(weight.item() - big.module.weight.item())
            updates += 1
            if rank == 0:
                print(f"update={updates} grad={accum_grad:.6f} "
                      f"w={weight.item():.6f} reference_gap={reference_gap:.2e} "
                      f"replica_gap={replica_gap:.2e}", flush=True)
            assert abs(accum_grad - big_grad) < 1e-6, "Gradient scale mismatch."
            assert reference_gap < 1e-6 and replica_gap < 1e-6
            if updates == 1:
                assert abs(accum_grad + 1.59375) < 1e-6
                assert abs(weight.item() - 0.159375) < 1e-6

        assert updates == 4
        if rank == 0:
            print("PASS: 8 micro-backwards, 4 updates; matches large batch.",
                  flush=True)
    finally:
        dist.destroy_process_group()


if __name__ == "__main__":
    main()
```

脚本创建两个独立 DDP 模型。A 每次用本地 4 条样本；B 将同样的 4 条切成两个大小为 2 的微批。这里 loader 的 batch 是 4，但 B 每次真正进入模型的微批是 2。两种写法从相同权重开始，对每次更新作数值比较。

正常运行：

```bash
OMP_NUM_THREADS=1 python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 ddp_lesson02.py
```

验收：四次更新完成，`replica_gap` 和 `reference_gap` 均小于 $10^{-6}$，最后打印 `PASS`。第一微批结束后，两个 rank 的 `unsynced_grad` 不同是预期行为；正常同步结束后才应相同。

再故意漏掉缩放：

```bash
OMP_NUM_THREADS=1 python -m torch.distributed.run \
  --standalone --nnodes=1 --nproc-per-node=2 ddp_lesson02.py --bad-scale
```

这次应在第一次更新后触发 `Gradient scale mismatch.`，进程非零退出。这是故意注入的错误，不应通过删除断言来“修复”。

## 6. 参考答案与预期数值

<details>
<summary>查看答案：batch、反向次数、更新次数</summary>

A、B 的有效全局 batch 都为 8。每个 rank 分到 16 条样本：

| 每轮、每个 rank | A | B |
| --- | ---: | ---: |
| backward 次数 | 4 | 8 |
| optimizer.step 次数 | 4 | 4 |

B 的两次反向之间参数保持不变，因此可以与 A 的一次大 batch 更新比较。若每个微批都 step，就成了不同的优化过程。

</details>

<details>
<summary>查看答案：正确梯度、漏缩放的结果与验收日志</summary>

正确梯度为：

$$
g=\frac{(-0.3125-2.3125)+(-0.625-3.125)}{2\times2}
=-1.59375
$$

一个 2 来自 rank 间平均，另一个来自微批间平均。第一次更新的权重为 $0-0.1\times(-1.59375)=0.159375$。

漏掉 loss 除以 2 后，梯度为 -3.1875，权重为 0.31875。两个 rank 仍然可能完全一致，但与正确参考模型相差 0.159375。

正常版本的关键预期数值：

```text
rank=0 unsynced_grad=-0.156250
rank=1 unsynced_grad=-0.312500
update=1 grad=-1.593750 w=0.159375
update=4 grad=-1.242299 w=0.565266
PASS: 8 micro-backwards, 4 updates; matches large batch.
```

rank 日志先后顺序不固定。数值是本例可计算的验收基线，不是性能测量。

`replica_gap` 检查各 rank 一致，`reference_gap` 检查实现是否与参考过程一致。`all_gather` 在这里仍然只是诊断，训练同步由 DDP 反向传播完成。

</details>

## 7. 复验时容易漏掉的条件

不要在每个微批开头清空梯度，也不要在每个微批结束就更新参数；否则无法累计。不要只把 backward 放入 no_sync，也不要额外除以 world_size。

本例没有 BatchNorm、Dropout 等影响微批行为的模块，才适合做严格的数值对照。真实模型拆微批后，计算行为不一定与一次大 batch 完全等价。

资料核对日期：2026-10-09。[PyTorch 梯度累积通信建议](https://docs.pytorch.org/tutorials/recipes/recipes/tuning_guide.html)提供了前 $K-1$ 次 no_sync、最后正常同步的做法。

上一篇：[从两个 CPU 进程看懂 DDP](/blog/ddp-basics-two-cpu-processes/)  
下一篇：[正确统计全局 loss](/blog/ddp-global-loss-metrics/)

