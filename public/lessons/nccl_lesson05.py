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
