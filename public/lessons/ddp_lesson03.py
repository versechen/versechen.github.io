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
