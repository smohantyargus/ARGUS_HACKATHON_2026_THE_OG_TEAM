import asyncio
import logging

logger = logging.getLogger(__name__)


class JobResultStore:
    """Maps job_id -> asyncio.Future for correlating Kafka results with HTTP requests."""

    def __init__(self):
        self._pending: dict[str, asyncio.Future] = {}

    def register(self, job_id: str) -> asyncio.Future:
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending[job_id] = future
        return future

    def resolve(self, job_id: str, result: dict):
        future = self._pending.pop(job_id, None)
        if future and not future.done():
            future.set_result(result)
        elif not future:
            logger.warning("Result arrived for unknown job_id=%s (already timed out?)", job_id)

    def cancel(self, job_id: str):
        future = self._pending.pop(job_id, None)
        if future and not future.done():
            future.cancel()

    async def wait(self, job_id: str, timeout: float = 120.0) -> dict:
        future = self._pending.get(job_id)
        if not future:
            raise ValueError(f"No pending job: {job_id}")
        return await asyncio.wait_for(future, timeout=timeout)


job_result_store = JobResultStore()
