import asyncio
import time


class RateLimitExceededError(Exception):
    pass


class RateLimiter:
    def __init__(self, capacity: int, refill_rate_per_second: float) -> None:
        self._capacity = capacity
        self._refill_rate = refill_rate_per_second
        self._tokens = float(capacity)
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self._capacity, self._tokens + elapsed * self._refill_rate)
        self._last_refill = now

    async def acquire(self, wait: bool = True, max_wait_seconds: float = 5.0) -> None:
        deadline = time.monotonic() + max_wait_seconds
        while True:
            async with self._lock:
                self._refill()
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                wait_for = (1 - self._tokens) / self._refill_rate
            if not wait or time.monotonic() + wait_for > deadline:
                raise RateLimitExceededError("OneMap gateway rate limit exceeded")
            await asyncio.sleep(min(wait_for, max(deadline - time.monotonic(), 0)))
