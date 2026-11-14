"""Keenable client: web search + clean page retrieval (docs.keenable.ai).

POST /v1/search  {query, max_results, snippet_max_length, published_after, ...}
GET  /v1/fetch   ?url=&max_chars=
Keyed calls send X-API-Key; without KEENABLE_API_KEY the keyless /public twins are used,
which require an X-Keenable-Title app identifier. Responses are cached on disk so re-runs
and demos don't spend requests.
"""
import asyncio
import hashlib
import json

import httpx

from .. import config

APP_TITLE = "ShelfTest"
CACHE = config.CACHE_DIR / "keenable"


class KeenableError(RuntimeError):
    pass


def client() -> httpx.AsyncClient:
    headers = {"X-Keenable-Title": APP_TITLE}
    if config.KEENABLE_API_KEY:
        headers["X-API-Key"] = config.KEENABLE_API_KEY
    return httpx.AsyncClient(base_url=config.KEENABLE_BASE_URL, timeout=45, headers=headers)


def _path(p: str) -> str:
    return p if config.KEENABLE_API_KEY else f"{p}/public"


def _cache(kind: str, params: dict) -> "Path":  # noqa: F821
    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(json.dumps([kind, params], sort_keys=True).encode()).hexdigest()[:24]
    return CACHE / f"{kind}-{key}.json"


async def _call(http: httpx.AsyncClient, method: str, path: str, **kw) -> dict:
    for attempt in range(4):
        r = await http.request(method, _path(path), **kw)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 3:
            await asyncio.sleep(float(r.headers.get("Retry-After", 2 ** attempt)))
            continue
        raise KeenableError(f"Keenable {r.status_code} {path}: {r.text[:300]}")
    raise KeenableError("unreachable")


async def search(http: httpx.AsyncClient, query: str, max_results: int = 8,
                 snippet_max_length: int = 600, published_after: str | None = None) -> list[dict]:
    """-> [{title, url, snippet, published_at}]"""
    body = {"query": query, "max_results": max_results, "snippet_max_length": snippet_max_length}
    if published_after:
        body["published_after"] = published_after
    path = _cache("search", body)
    if path.exists():
        return json.loads(path.read_text())
    data = await _call(http, "POST", "/v1/search", json=body)
    out = [{k: r.get(k) for k in ("title", "url", "snippet", "published_at")} for r in data.get("results", [])]
    path.write_text(json.dumps(out))
    return out


async def fetch(http: httpx.AsyncClient, url: str, max_chars: int = 6000) -> dict:
    """-> {url, title, content (markdown), published_at}"""
    params = {"url": url, "max_chars": max_chars}
    path = _cache("fetch", params)
    if path.exists():
        return json.loads(path.read_text())
    data = await _call(http, "GET", "/v1/fetch", params=params)
    out = {k: data.get(k) for k in ("url", "title", "content", "published_at")}
    path.write_text(json.dumps(out))
    return out
