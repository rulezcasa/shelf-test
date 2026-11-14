"""Thin NDI client over the Nace console API: upload a local file, run an extract job, wait for the result."""
import json
import re
import time
import uuid
from pathlib import Path

import httpx

from .. import config

TERMINAL = {"succeeded", "failed", "cancelled"}


class NDIError(RuntimeError):
    pass


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=config.NACE_BASE_URL,
        headers={"Authorization": f"Bearer {config.NACE_API_KEY}", "X-Nace-Client": "shelf-test/1"},
        timeout=150,
    )


def describe_error(service: str, r: httpx.Response) -> str:
    """The raw error as the server sent it: status, notable headers, and the body (HTML pages reduced to <title>)."""
    head = f"{service} {r.request.method} {r.request.url.path} -> {r.status_code} {r.reason_phrase}"
    hdrs = [f"{k}: {r.headers[k]}" for k in ("server", "x-vercel-mitigated", "retry-after", "x-vercel-id") if k in r.headers]
    body = r.text or ""
    title = re.search(r"<title>(.*?)</title>", body, re.S)
    shown = f"HTML page <title>{title.group(1).strip()}</title>" if title else body[:500]
    return f"{head} [{'; '.join(hdrs)}] {shown}".replace(" [] ", " ")


def _check(r: httpx.Response) -> dict:
    if r.status_code >= 400:
        raise NDIError(describe_error("NDI", r))
    return r.json()


def _wait(client: httpx.Client, job: dict, timeout_s: float) -> dict:
    deadline = time.monotonic() + timeout_s
    while job.get("status") not in TERMINAL:
        if time.monotonic() > deadline:
            raise NDIError(f"NDI job {job['job_id']} timed out (last status: {job.get('status')})")
        time.sleep(2)
        job = _check(client.get(f"/v1/documents/jobs/{job['job_id']}"))
    if job["status"] != "succeeded":
        raise NDIError(f"NDI job {job['job_id']} {job['status']}: {job.get('error') or job.get('result_error')}")
    return job


def upload(path: Path, timeout_s: float = 120) -> dict:
    """Upload a local file; returns a `workspace_file` source for extract/parse.

    Upload grant -> multipart POST to the grant's URL -> job whose result.file has the ids.
    """
    remote = f"shelf-test/{uuid.uuid4().hex[:8]}-{path.name}"  # unique path: avoids 409 path_conflict
    with _client() as client:
        grant = _check(client.post("/v1/documents/upload-grants", json={"path": remote, "ttl_seconds": 600}))
        with path.open("rb") as f:
            r = httpx.post(
                grant["upload_url"],
                headers={"X-Upload-Token": grant["token"]},
                files={"file": (path.name, f)},
                data={"metadata": json.dumps({"path": remote})},
                timeout=120,
            )
        job = _wait(client, _check(r), timeout_s)
    file = job["result"]["file"]
    return {"type": "workspace_file", "workspace_id": file["workspace_id"], "file_id": file["file_id"]}


def parse(source: dict, timeout_s: float = 600) -> dict:
    """POST /v1/documents/parse (markdown) and wait. Returns the finished job's `result`.
    For audio/video the transcript is only inlined when the job is read by id, so we re-read it."""
    with _client() as client:
        job = _check(client.post(
            "/v1/documents/parse",
            params={"wait_seconds": 120},
            json={"source": source, "output": {"formats": ["markdown"]}},
        ))
        job = _wait(client, job, timeout_s)
        job = _check(client.get(f"/v1/documents/jobs/{job['job_id']}"))
    return job["result"]


def extract(source: dict, schema: dict, instructions: str, timeout_s: float = 240) -> dict:
    """POST /v1/documents/extract and poll until done. Returns the job's `result` dict.

    `source` is an NDI source object, e.g. {"type": "url", "url": "https://...", "file_name": "x.pdf"}.
    """
    with _client() as client:
        job = _check(client.post(
            "/v1/documents/extract",
            params={"wait_seconds": 120},
            json={
                "source": source,
                "schema": schema,
                "instructions": instructions,
                "citations": {"enabled": True, "include_source_text": True},
            },
        ))
        job = _wait(client, job, timeout_s)

    return job["result"]
