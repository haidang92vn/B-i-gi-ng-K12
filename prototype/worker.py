"""Redis worker process scaffold.

No background job type is enabled yet.  The process validates Redis connectivity and is
ready to own long-running jobs when a job producer is introduced in a later milestone.
"""
from __future__ import annotations

import logging
import os
import signal
import time

import redis

from prototype.logging_config import configure_logging

running = True
logger = logging.getLogger("scorm.worker")


def _stop(*_args) -> None:
    global running
    running = False


def main() -> None:
    configure_logging()
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    client = redis.from_url(os.environ["REDIS_URL"], socket_connect_timeout=5, health_check_interval=30)
    while running:
        try:
            client.ping()
            logger.info("worker_ready")
            while running:
                time.sleep(30)
                client.ping()
        except redis.RedisError:
            logger.warning("worker_redis_unavailable")
            time.sleep(5)
    client.close()


if __name__ == "__main__":
    main()
