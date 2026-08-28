import asyncio
import time

import pytest

from geo_encoding_gateway.rate_limiter import RateLimiter, RateLimitExceededError


def test_rate_limiter_allows_up_to_capacity_immediately() -> None:
    limiter = RateLimiter(capacity=5, refill_rate_per_second=5 / 60)

    async def _consume() -> None:
        for _ in range(5):
            await limiter.acquire(wait=False)

    start = time.monotonic()
    asyncio.run(_consume())
    assert time.monotonic() - start < 0.1


def test_rate_limiter_rejects_beyond_capacity_when_not_waiting() -> None:
    limiter = RateLimiter(capacity=2, refill_rate_per_second=2 / 60)

    async def _exhaust_then_reject() -> None:
        await limiter.acquire(wait=False)
        await limiter.acquire(wait=False)
        with pytest.raises(RateLimitExceededError):
            await limiter.acquire(wait=False)

    asyncio.run(_exhaust_then_reject())


def test_rate_limiter_blocks_and_waits_beyond_capacity() -> None:
    limiter = RateLimiter(capacity=2, refill_rate_per_second=2.0)

    async def _exhaust_then_wait() -> None:
        await limiter.acquire(wait=False)
        await limiter.acquire(wait=False)
        await limiter.acquire(wait=True, max_wait_seconds=2.0)

    start = time.monotonic()
    asyncio.run(_exhaust_then_wait())
    elapsed = time.monotonic() - start
    # Refilling at 2 tokens/sec means the 3rd token becomes available after ~0.5s.
    assert 0.3 <= elapsed <= 1.5


def test_rate_limiter_wait_exceeding_deadline_raises() -> None:
    limiter = RateLimiter(capacity=1, refill_rate_per_second=1 / 100)

    async def _exhaust_then_timeout() -> None:
        await limiter.acquire(wait=False)
        await limiter.acquire(wait=True, max_wait_seconds=0.05)

    with pytest.raises(RateLimitExceededError):
        asyncio.run(_exhaust_then_timeout())


def test_rate_limiter_refills_over_time() -> None:
    limiter = RateLimiter(capacity=3, refill_rate_per_second=3.0)

    async def _exhaust_wait_then_acquire() -> None:
        for _ in range(3):
            await limiter.acquire(wait=False)
        await asyncio.sleep(0.5)
        await limiter.acquire(wait=False)

    asyncio.run(_exhaust_wait_then_acquire())


def test_rate_limiter_throughput_capped_over_window() -> None:
    limiter = RateLimiter(capacity=5, refill_rate_per_second=5.0)

    async def _fire_bursts() -> None:
        await asyncio.gather(
            *(limiter.acquire(wait=True, max_wait_seconds=5.0) for _ in range(15))
        )

    start = time.monotonic()
    asyncio.run(_fire_bursts())
    elapsed = time.monotonic() - start
    # 5 tokens available immediately, the remaining 10 must wait for refills
    # at 5/sec - proves the burst was NOT let through instantly.
    assert elapsed >= 1.5
