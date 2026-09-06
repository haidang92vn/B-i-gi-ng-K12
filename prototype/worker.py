"""Redis worker for durable SCORM export jobs.

Redis carries only a job id.  Job state, course data and exports remain in PostgreSQL/R2.
The synchronous export endpoint remains available for small interactive downloads; this worker
is the production path for long-running exports.
"""
from __future__ import annotations

import logging
import os
import signal
import time
from datetime import datetime, timedelta, timezone

import redis
from fastapi import HTTPException
from sqlalchemy import select, update

from prototype.jobs import QueueUnavailable, client_from_env, dequeue_export_job
from prototype.logging_config import configure_logging

running = True
logger = logging.getLogger("scorm.worker")


def _stop(*_args) -> None:
    global running
    running = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _mark_failed(db, job_id: str, code: str, message: str) -> None:
    """Persist only a user-safe failure message, never an upstream exception string."""
    db.rollback()
    from prototype.persistence import ExportJob

    job = db.get(ExportJob, job_id)
    if job is not None and job.status in {"queued", "running"}:
        job.status = "failed"
        job.error_code = code
        job.error_message_safe = message[:500]
        job.finished_at = _now()
        db.commit()


def process_export_job(job_id: str, *, runtime_module=None) -> None:
    """Claim and execute one queued export exactly once per successful claim."""
    # Importing the API module here avoids a worker/API import cycle and gives the worker the
    # same canonical renderer, validation and private storage adapter as direct exports.
    if runtime_module is None:
        from prototype import main as runtime_module

    ExportRequest = runtime_module.ExportRequest
    ExportJob = runtime_module.ExportJob
    Project = runtime_module.Project
    User = runtime_module.User
    db = runtime_module.SessionLocal()
    try:
        claimed = db.execute(
            update(ExportJob)
            .where(ExportJob.id == job_id, ExportJob.status == "queued")
            .values(status="running", started_at=_now(), error_code=None, error_message_safe=None)
        )
        db.commit()
        if claimed.rowcount != 1:
            return

        job = db.get(ExportJob, job_id)
        project = db.get(Project, job.project_id) if job else None
        user = db.get(User, job.user_id) if job else None
        if job is None or project is None or user is None:
            _mark_failed(db, job_id, "EXPORT_INPUT_NOT_FOUND", "Dự án hoặc tài khoản xuất không còn tồn tại.")
            return
        if project.revision != job.input_revision:
            _mark_failed(db, job_id, "COURSE_REVISION_CHANGED", "Bài giảng đã thay đổi trước khi xuất. Hãy tạo yêu cầu xuất mới.")
            return

        response = runtime_module.export_scorm(
            ExportRequest(title="background-export", direction="lesson", objectives=[], sections=[], quizzes=[], project_id=project.id),
            user,
            db,
        )
        export_record_id = response.headers.get("X-Export-Id")
        if not export_record_id:
            _mark_failed(db, job_id, "EXPORT_RECORD_MISSING", "Không thể lưu lịch sử xuất SCORM.")
            return

        job = db.get(ExportJob, job_id)
        if job is not None:
            job.status = "ready"
            job.export_record_id = export_record_id
            job.finished_at = _now()
            db.commit()
            logger.info("export_job_ready job_id=%s", job_id)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        code = str(detail.get("code", "SCORM_EXPORT_FAILED"))
        _mark_failed(db, job_id, code, "Không thể xuất ZIP SCORM. Hãy kiểm tra nội dung và thử lại.")
        logger.warning("export_job_rejected job_id=%s code=%s", job_id, code)
    except Exception:
        _mark_failed(db, job_id, "EXPORT_WORKER_FAILED", "Không thể xuất ZIP SCORM. Hãy thử lại sau.")
        # Deliberately omit the exception/traceback: upstream storage exceptions can contain
        # signed URLs or provider details that do not belong in production logs.
        logger.error("export_job_failed job_id=%s", job_id)
    finally:
        db.close()


def recover_stale_jobs() -> list[str]:
    """Return jobs abandoned by a terminated worker so they can be requeued on startup."""
    from prototype.main import SessionLocal
    from prototype.persistence import ExportJob

    db = SessionLocal()
    try:
        cutoff = _now() - timedelta(minutes=15)
        job_ids = list(db.scalars(select(ExportJob.id).where(ExportJob.status == "running", ExportJob.started_at < cutoff)).all())
        if job_ids:
            db.execute(update(ExportJob).where(ExportJob.id.in_(job_ids)).values(status="queued", started_at=None))
            db.commit()
        return job_ids
    finally:
        db.close()


def main() -> None:
    configure_logging()
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    while running:
        client = None
        try:
            client = client_from_env()
            client.ping()
            logger.info("worker_ready")
            for abandoned_id in recover_stale_jobs():
                client.lpush("ai-scorm-studio:export-jobs:v1", abandoned_id)
                logger.warning("export_job_requeued job_id=%s", abandoned_id)
            while running:
                job_id = dequeue_export_job(client)
                if job_id:
                    process_export_job(job_id)
        except (QueueUnavailable, redis.RedisError):
            logger.warning("worker_redis_unavailable")
            time.sleep(5)
        finally:
            if client is not None:
                client.close()


if __name__ == "__main__":
    main()
