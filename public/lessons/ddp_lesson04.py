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
