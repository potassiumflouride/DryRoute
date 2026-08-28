from __future__ import annotations

import asyncio
import math
import random
import time
from dataclasses import dataclass

from loadtest.config import LoadConfig
from loadtest.workloads import Workloads


@dataclass(frozen=True)
class PhaseState:
    name: str
    users: int
    think_time_enabled: bool


def phase_at(elapsed: float, duration: float, max_users: int) -> PhaseState:
    """Return the 10% warm-up, 10% ramp, 60% hold, 5% burst, 15% cool-down state."""
    progress = min(max(elapsed / duration, 0.0), 1.0)
    warm_users = max(1, math.ceil(max_users * 0.2))
    if progress < 0.10:
        users = max(1, math.ceil(warm_users * progress / 0.10))
        return PhaseState("warm-up", users, True)
    if progress < 0.20:
        ratio = (progress - 0.10) / 0.10
        users = math.ceil(warm_users + (max_users - warm_users) * ratio)
        return PhaseState("ramp", users, True)
    if progress < 0.80:
        return PhaseState("hold", max_users, True)
    if progress < 0.85:
        return PhaseState("burst", max_users, False)
    ratio = (progress - 0.85) / 0.15
    return PhaseState("cool-down", max(0, math.ceil(max_users * (1.0 - ratio))), True)


class LoadScheduler:
    def __init__(self, config: LoadConfig, workloads: Workloads) -> None:
        self.config = config
        self.workloads = workloads
        self._tasks: dict[int, asyncio.Task[None]] = {}
        self._stop_events: dict[int, asyncio.Event] = {}
        self._phase = PhaseState("starting", 0, True)
        self._phase_changed = asyncio.Event()
        self._burst_generation = 0
        self._burst_barrier: asyncio.Barrier | None = None
        self.phase_history: list[str] = []

    async def run(self) -> float:
        started = time.perf_counter()
        previous_phase = ""
        while True:
            elapsed = time.perf_counter() - started
            if elapsed >= self.config.duration_seconds:
                break
            state = phase_at(elapsed, self.config.duration_seconds, self.config.max_users)
            self._phase = state
            await self._resize(state.users)
            if state.name != previous_phase:
                self.phase_history.append(state.name)
                print(f"[{elapsed:6.1f}s] {state.name}: target {state.users} users", flush=True)
                if state.name == "burst":
                    await self._start_synchronized_burst()
                else:
                    self._notify_phase_change()
                previous_phase = state.name
            tick_seconds = min(0.25, self.config.duration_seconds * 0.01)
            await asyncio.sleep(min(tick_seconds, max(self.config.duration_seconds - elapsed, 0.001)))

        await self._resize(0)
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        return time.perf_counter() - started

    async def _resize(self, target: int) -> None:
        active = [worker_id for worker_id, task in self._tasks.items() if not task.done()]
        for worker_id in list(self._tasks):
            if self._tasks[worker_id].done():
                self._tasks.pop(worker_id)
                self._stop_events.pop(worker_id, None)
        if target > len(active):
            next_id = max(self._tasks, default=-1) + 1
            for worker_id in range(next_id, next_id + target - len(active)):
                stop_event = asyncio.Event()
                self._stop_events[worker_id] = stop_event
                self._tasks[worker_id] = asyncio.create_task(self._worker(worker_id, stop_event))
        elif target < len(active):
            for worker_id in sorted(active, reverse=True)[: len(active) - target]:
                self._stop_events[worker_id].set()

    async def _worker(self, worker_id: int, stop_event: asyncio.Event) -> None:
        rng = random.Random(self.config.random_seed + worker_id)
        seen_burst = 0
        while not stop_event.is_set():
            if self._burst_generation > seen_burst and self._burst_barrier is not None:
                seen_burst = self._burst_generation
                try:
                    await self._burst_barrier.wait()
                except asyncio.BrokenBarrierError:
                    pass
                if stop_event.is_set():
                    break
            await self.workloads.iteration(rng)
            if self._phase.think_time_enabled:
                delay = rng.uniform(self.config.think_time_min_seconds, self.config.think_time_max_seconds)
                try:
                    await asyncio.wait_for(self._phase_changed.wait(), timeout=delay)
                except TimeoutError:
                    pass

    async def _start_synchronized_burst(self) -> None:
        active_count = sum(not task.done() for task in self._tasks.values())
        if active_count == 0:
            return
        self._burst_generation += 1
        self._burst_barrier = asyncio.Barrier(active_count + 1)
        self._notify_phase_change()
        try:
            async with asyncio.timeout(self.config.request_timeout_seconds + 5):
                await self._burst_barrier.wait()
        except TimeoutError:
            await self._burst_barrier.abort()

    def _notify_phase_change(self) -> None:
        self._phase_changed.set()
        self._phase_changed = asyncio.Event()


async def run_preflight(config: LoadConfig, workloads: Workloads) -> float:
    started = time.perf_counter()
    rng = random.Random(config.random_seed)
    await workloads.iteration(rng)
    return time.perf_counter() - started
