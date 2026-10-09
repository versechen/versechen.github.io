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
