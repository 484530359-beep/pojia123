#!/usr/bin/env python3
"""HarnessKit Playground run-result receiver."""

from __future__ import annotations

import cgi
import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = os.environ.get("HK_UPLOAD_HOST", "0.0.0.0")
PORT = int(os.environ.get("HK_UPLOAD_PORT", "18400"))
ROOT = Path(os.environ.get("HK_UPLOAD_ROOT", "/var/lib/harnesskit-playground"))
SAFE_PART = re.compile(r"[^0-9A-Za-z._-]+")


def safe_part(value: str, fallback: str) -> str:
    cleaned = SAFE_PART.sub("_", str(value or "").strip()).strip("._-")
    return cleaned[:120] or fallback


def safe_relative_path(value: str, fallback: str) -> Path:
    parts = []
    for part in str(value or "").replace("\\", "/").split("/"):
        if part and part not in {".", ".."}:
            parts.append(safe_part(part, "file"))
    return Path(*parts) if parts else Path(fallback)


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class UploadHandler(BaseHTTPRequestHandler):
    server_version = "HarnessKitPlayground/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

    def send_json(self, status: int, payload: dict) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/health":
            self.send_json(200, {"ok": True, "service": "harnesskit-playground-receiver", "port": PORT})
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/upload":
            self.send_json(404, {"ok": False, "error": "not found"})
            return

        content_type = self.headers.get("Content-Type", "")
        content_length = self.headers.get("Content-Length")
        if not content_length:
            self.send_json(411, {"ok": False, "error": "Content-Length required"})
            return
        try:
            body_length = int(content_length)
        except ValueError:
            self.send_json(400, {"ok": False, "error": "invalid Content-Length"})
            return
        if body_length <= 0:
            self.send_json(400, {"ok": False, "error": "empty request"})
            return
        if not content_type.lower().startswith("multipart/form-data"):
            self.send_json(415, {"ok": False, "error": "multipart/form-data required"})
            return

        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": content_type,
                    "CONTENT_LENGTH": str(body_length),
                },
                keep_blank_values=True,
            )
            item = form["file"] if "file" in form else None
            if item is None or not getattr(item, "file", None):
                self.send_json(400, {"ok": False, "error": "file field required"})
                return

            relative_path = safe_relative_path(
                form.getfirst("relativePath", ""),
                getattr(item, "filename", None) or "result.bin",
            )
            app_name = safe_part(form.getfirst("appName", ""), "harnesskit")
            variant = safe_part(form.getfirst("variant", ""), "desktop")
            now = datetime.now(timezone.utc)
            upload_id = f"{now.strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex}"
            target_dir = ROOT / app_name / variant / now.strftime("%Y-%m-%d") / upload_id
            target_file = target_dir / relative_path
            target_file.parent.mkdir(parents=True, exist_ok=True)

            digest = hashlib.sha256()
            size = 0
            with target_file.open("wb") as output:
                while True:
                    chunk = item.file.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)

            metadata = {
                "receivedAt": now.isoformat(),
                "remoteAddress": self.client_address[0],
                "appName": app_name,
                "appVersion": safe_part(form.getfirst("appVersion", ""), "unknown"),
                "variant": variant,
                "uploadRole": safe_part(form.getfirst("uploadRole", ""), "playground-file"),
                "relativePath": str(relative_path).replace(os.sep, "/"),
                "filename": getattr(item, "filename", None) or relative_path.name,
                "size": size,
                "sha256": digest.hexdigest(),
            }
            (target_dir / "metadata.json").write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            self.send_json(201, {"ok": True, "uploadId": upload_id, "size": size, "sha256": digest.hexdigest()})
        except Exception as exc:  # pragma: no cover - production error boundary
            print(f"upload failed: {exc!r}", flush=True)
            self.send_json(500, {"ok": False, "error": "upload failed"})


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), UploadHandler)
    print(f"listening on {HOST}:{PORT}, storage={ROOT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
