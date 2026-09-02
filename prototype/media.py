"""Validation rules for teacher media before it reaches object storage."""
from __future__ import annotations

import ipaddress
from pathlib import Path
from urllib.parse import urlparse


IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
AUDIO_TYPES = {"audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg", "audio/mp4": ".m4a"}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm"}
ALLOWED_MEDIA = {**IMAGE_TYPES, **AUDIO_TYPES, **VIDEO_TYPES}
MAX_BYTES = {"image": 10 * 1024 * 1024, "audio": 25 * 1024 * 1024, "video": 200 * 1024 * 1024}
SCORM_VIDEO_WARNING_BYTES = 25 * 1024 * 1024


def kind_for_mime(mime_type: str) -> str:
    if mime_type in IMAGE_TYPES:
        return "image"
    if mime_type in AUDIO_TYPES:
        return "audio"
    if mime_type in VIDEO_TYPES:
        return "video"
    raise ValueError("Chỉ nhận ảnh (JPG/PNG/WebP/GIF), âm thanh (MP3/WAV/OGG/M4A) hoặc video (MP4/WebM).")


def extension_for_mime(mime_type: str) -> str:
    return ALLOWED_MEDIA[mime_type]


def _matches_signature(mime_type: str, content: bytes) -> bool:
    if mime_type == "image/jpeg": return content.startswith(b"\xff\xd8\xff")
    if mime_type == "image/png": return content.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/gif": return content.startswith((b"GIF87a", b"GIF89a"))
    if mime_type == "image/webp": return content.startswith(b"RIFF") and content[8:12] == b"WEBP"
    if mime_type == "audio/wav": return content.startswith(b"RIFF") and content[8:12] == b"WAVE"
    if mime_type == "audio/mpeg": return content.startswith((b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"))
    if mime_type == "audio/ogg": return content.startswith(b"OggS")
    if mime_type in {"audio/mp4", "video/mp4"}: return len(content) >= 12 and content[4:8] == b"ftyp"
    if mime_type == "video/webm": return content.startswith(b"\x1a\x45\xdf\xa3")
    return False


def validate_media_upload(filename: str, content_type: str, content: bytes) -> str:
    kind = kind_for_mime(content_type)
    if not filename or Path(filename).suffix.lower() != extension_for_mime(content_type):
        raise ValueError("Phần mở rộng tệp không khớp với loại media đã khai báo.")
    if not content or len(content) > MAX_BYTES[kind]:
        raise ValueError(f"Tệp {kind} phải có dung lượng từ 1 byte đến {MAX_BYTES[kind] // 1024 // 1024} MB.")
    if not _matches_signature(content_type, content):
        raise ValueError("Nội dung tệp không khớp với loại media đã khai báo.")
    return kind


def validate_media_url(url: str, kind: str) -> str:
    if kind not in MAX_BYTES:
        raise ValueError("Loại media không hợp lệ.")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Chỉ cho phép URL HTTPS công khai, không kèm thông tin đăng nhập.")
    try:
        address = ipaddress.ip_address(parsed.hostname)
        if not address.is_global:
            raise ValueError("URL không được trỏ tới địa chỉ nội bộ.")
    except ValueError as exc:
        if "địa chỉ nội bộ" in str(exc):
            raise
    if parsed.hostname.lower() in {"localhost", "localhost.localdomain"}:
        raise ValueError("URL không được trỏ tới máy cục bộ.")
    return kind
