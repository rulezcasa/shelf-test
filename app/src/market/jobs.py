"""Background market research, one job per product, started automatically with each test run.

The job runs alongside the Drex panel (research takes ~30-60 s), so a run uses the product's
previously saved research, if any, as Drex context; the fresh research is saved when it finishes.
"""
import asyncio
import logging
from datetime import datetime, timezone

from ..models import Product

log = logging.getLogger(__name__)

STEPS = ["plan", "search", "read", "analyze"]
_jobs: dict[str, dict] = {}    # pid -> {status, step, started_at, finished_at, error}
_tasks: dict[str, asyncio.Task] = {}


def status(pid: str) -> dict:
    return _jobs.get(pid) or {"status": "idle", "step": None, "steps": STEPS}


def start(product: Product) -> dict:
    """Start research for this product unless a job is already running. Returns the job status."""
    if _jobs.get(product.id, {}).get("status") == "running":
        return _jobs[product.id]
    job = {"status": "running", "step": STEPS[0], "steps": STEPS, "error": None,
           "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "finished_at": None}
    _jobs[product.id] = job
    _tasks[product.id] = asyncio.create_task(_run(product, job))
    return job


async def _run(product: Product, job: dict) -> None:
    from ..api import store
    from . import intel

    def on_step(step: str) -> None:
        job["step"] = step

    try:
        store.save_market(product.id, await intel.build(product, on_step=on_step))
        job["status"] = "done"
    except Exception as e:
        log.error("market research for %s failed: %s", product.id, e)
        job["status"], job["error"] = "error", str(e)
    finally:
        job["step"] = None
        job["finished_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _tasks.pop(product.id, None)
