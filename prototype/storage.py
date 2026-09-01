"""Private object storage boundary; uses Cloudflare R2 through S3 credentials."""
from __future__ import annotations
import os
import tempfile
from pathlib import Path
import boto3


class Storage:
    def _client(self):
        return boto3.client(
            "s3",
            endpoint_url=os.environ["S3_ENDPOINT_URL"],
            region_name=os.getenv("S3_REGION", "auto"),
            aws_access_key_id=os.getenv("S3_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY"),
        )

    @staticmethod
    def _local_root() -> Path:
        configured = os.getenv("LOCAL_OBJECT_STORAGE_DIR")
        return Path(configured) if configured else Path(tempfile.gettempdir()) / "ai-scorm-studio-objects"

    def put(self, key: str, content: bytes, content_type: str) -> None:
        endpoint = os.getenv("S3_ENDPOINT_URL")
        if endpoint:
            self._client().put_object(Bucket=os.environ["S3_BUCKET"], Key=key, Body=content, ContentType=content_type)
            return
        target = self._local_root() / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def get(self, key: str) -> bytes:
        endpoint = os.getenv("S3_ENDPOINT_URL")
        if endpoint:
            return self._client().get_object(Bucket=os.environ["S3_BUCKET"], Key=key)["Body"].read()
        return (self._local_root() / key).read_bytes()

    def healthcheck(self) -> str:
        """Verify the configured object-store boundary without creating user data."""
        if os.getenv("S3_ENDPOINT_URL"):
            self._client().head_bucket(Bucket=os.environ["S3_BUCKET"])
            return "r2"
        self._local_root().mkdir(parents=True, exist_ok=True)
        return "local"
