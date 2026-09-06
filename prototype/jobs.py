"""Small Redis boundary for durable background jobs.

The queue never stores course data, media paths, credentials or user information.
Those values stay in PostgreSQL/R2; Redis carries a single opaque job id.
"""
from __future__ import annotations

import os

import redis

EXPORT_QUEUE = "ai-scorm-studio:export-jobs:v1"


class QueueUnavailable(RuntimeError):
    """Raised when a job cannot safely be handed to the worker."""


def client_from_env() -> redis.Redis:
    url = os.getenv("REDIS_URL")
    if not url:
        raise QueueUnavailable("Redis is not configured.")
    return redis.from_url(url, decode_responses=True, socket_connect_timeout=5, health_check_interval=30)


def enqueue_export_job(job_id: str) -> None:
    client = client_from_env()
    try:
        client.lpush(EXPORT_QUEUE, job_id)
    except redis.RedisError as exc:
        raise QueueUnavailable("Redis is unavailable.") from exc
    finally:
        client.close()


def dequeue_export_job(client: redis.Redis, *, timeout_seconds: int = 5) -> str | None:
    try:
        item = client.brpop(EXPORT_QUEUE, timeout=timeout_seconds)
    except redis.RedisError as exc:
        raise QueueUnavailable("Redis is unavailable.") from exc
    return item[1] if item else None
