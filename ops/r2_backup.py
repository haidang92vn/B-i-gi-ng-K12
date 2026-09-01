"""Upload, retain, and retrieve encrypted PostgreSQL backups from a dedicated R2 bucket."""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3


PREFIX = "postgres/"


def client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["BACKUP_S3_ENDPOINT_URL"],
        region_name=os.getenv("BACKUP_S3_REGION", "auto"),
        aws_access_key_id=os.environ["BACKUP_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["BACKUP_S3_SECRET_ACCESS_KEY"],
    )


def bucket() -> str:
    return os.environ["BACKUP_S3_BUCKET"]


def upload(source: Path, key: str) -> None:
    if not key.startswith(PREFIX):
        raise ValueError("Backup key must be within the postgres/ prefix.")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    client().upload_file(str(source), bucket(), key, ExtraArgs={"Metadata": {"sha256": digest, "encrypted": "gpg-aes256"}})
    print(f"backup_uploaded key={key} sha256={digest}")


def download(key: str, target: Path) -> None:
    if not key.startswith(PREFIX):
        raise ValueError("Backup key must be within the postgres/ prefix.")
    target.parent.mkdir(parents=True, exist_ok=True)
    storage = client()
    metadata = storage.head_object(Bucket=bucket(), Key=key).get("Metadata", {})
    storage.download_file(bucket(), key, str(target))
    expected_digest = metadata.get("sha256")
    if expected_digest and hashlib.sha256(target.read_bytes()).hexdigest() != expected_digest:
        raise OSError("Downloaded backup integrity check failed.")
    print(f"backup_downloaded key={key}")


def prune() -> None:
    retention_days = int(os.getenv("BACKUP_RETENTION_DAYS", "35"))
    if retention_days < 7:
        raise ValueError("BACKUP_RETENTION_DAYS must be at least 7.")
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    paginator = client().get_paginator("list_objects_v2")
    deleted = 0
    for page in paginator.paginate(Bucket=bucket(), Prefix=PREFIX):
        for item in page.get("Contents", []):
            if item["LastModified"] < cutoff:
                client().delete_object(Bucket=bucket(), Key=item["Key"])
                deleted += 1
    print(f"backup_pruned count={deleted}")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    upload_parser = commands.add_parser("upload")
    upload_parser.add_argument("source", type=Path)
    upload_parser.add_argument("key")
    download_parser = commands.add_parser("download")
    download_parser.add_argument("key")
    download_parser.add_argument("target", type=Path)
    commands.add_parser("prune")
    args = parser.parse_args()
    if args.command == "upload":
        upload(args.source, args.key)
    elif args.command == "download":
        download(args.key, args.target)
    else:
        prune()


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, OSError) as exc:
        print(f"backup_error type={type(exc).__name__}", file=sys.stderr)
        raise SystemExit(2) from exc
