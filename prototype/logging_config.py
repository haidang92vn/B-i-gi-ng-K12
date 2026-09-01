"""Small structured logger with defensive secret redaction for production services."""
from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime, timezone


_SECRET_PATTERNS = (
    re.compile(r"(?i)(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+"),
    re.compile(r"(?i)(cookie\s*[:=]\s*)[^\r\n]+"),
    re.compile(r"(?i)((?:api[_-]?key|password|secret|token|credential_encryption_key)\s*[=:]\s*[\"']?)[^\"'\s,;]+"),
    re.compile(r"sk-[A-Za-z0-9_-]{8,}"),
)


def redact(value: object) -> str:
    text = str(value)
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(lambda match: f"{match.group(1)}[REDACTED]" if match.lastindex else "[REDACTED]", text)
    return text


class RedactingJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        for name in ("request_id", "method", "path", "status_code"):
            if hasattr(record, name):
                payload[name] = redact(getattr(record, name))
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    """Install one stdout handler once; never serialize arbitrary request payloads."""
    root = logging.getLogger()
    if any(getattr(handler, "_scorm_structured", False) for handler in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler._scorm_structured = True  # type: ignore[attr-defined]
    handler.setFormatter(RedactingJsonFormatter())
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
