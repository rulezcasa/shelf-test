"""HTTP API for the webapp. Run from app/:  uvicorn src.main:app --reload --port 8000

Products hold variants; uploading a variant document stores the original PDF and extracts it
with NDI right away. Extracted fields can be edited and saved back.
"""
import json
import string
from pathlib import Path
import threading
from collections import defaultdict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from .models import Attribute, Persona, Product, Variant
from .ndi import extract_persona
from .ndi.extract_variants import extract_variant
from .ndi.ndi_client import NDIError

from .api import benchmarks, personas, runs, store
from .model.drex_client import DrexError
from .model.panel import load_personas

app = FastAPI(title="ShelfTest API")

# One upload at a time per product: the next letter is picked and the variant saved under this lock,
# so concurrent uploads can't both become "A", and each extraction sees the earlier variants' names.
_upload_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)


def _product(pid: str) -> Product:
    try:
        return store.get(pid)
    except KeyError:
        raise HTTPException(404, f"product {pid} not found")


def _variant(p: Product, vid: str) -> Variant:
    for v in p.variants:
        if v.variant_id == vid:
            return v
    raise HTTPException(404, f"variant {vid} not found")


# ---- products ---------------------------------------------------------------

class ProductIn(BaseModel):
    name: str


@app.get("/api/products")
def list_products() -> list[Product]:
    return store.list_products()


@app.post("/api/products", status_code=201)
def create_product(body: ProductIn) -> Product:
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "name is required")
    return store.create(name)


@app.get("/api/products/{pid}")
def get_product(pid: str) -> Product:
    return _product(pid)


@app.patch("/api/products/{pid}")
def rename_product(pid: str, body: ProductIn) -> Product:
    p = _product(pid)
    p.name = body.name.strip() or p.name
    return store.save(p)


@app.delete("/api/products/{pid}", status_code=204)
def delete_product(pid: str) -> None:
    _product(pid)
    store.delete(pid)


# ---- variants ---------------------------------------------------------------

@app.post("/api/products/{pid}/variants", status_code=201)
def upload_variant(pid: str, file: UploadFile = File(...)) -> Variant:
    """Store the PDF, extract it with NDI (takes ~10-30 s), append as the next free letter."""
    _product(pid)
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(422, "only PDF files are supported")
    data = file.file.read()
    with _upload_locks[pid]:
        return _add_variant(pid, file.filename, data)


def _add_variant(pid: str, filename: str, data: bytes) -> Variant:
    p = _product(pid)
    used = {v.variant_id for v in p.variants}
    vid = next((c for c in string.ascii_uppercase if c not in used), None)
    if vid is None:
        raise HTTPException(422, "too many variants")

    path = store.file_path(pid, vid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    known = list(dict.fromkeys(a.name for v in p.variants for a in v.attributes))
    try:
        v = extract_variant(path, vid, known)
    except NDIError as e:
        path.unlink(missing_ok=True)
        raise HTTPException(502, f"NDI extraction failed: {e}")
    v.source_file = filename

    p = _product(pid)  # re-read: fields may have been edited during the slow extract
    p.variants.append(v)
    p.variants.sort(key=lambda x: x.variant_id)
    store.save(p)
    return v


class VariantIn(BaseModel):
    product_name: str | None = None
    attributes: list[Attribute]


@app.put("/api/products/{pid}/variants/{vid}")
def update_variant(pid: str, vid: str, body: VariantIn) -> Variant:
    """Save user edits to the extracted fields."""
    p = _product(pid)
    v = _variant(p, vid)
    names = [a.name.strip() for a in body.attributes]
    if any(not n for n in names):
        raise HTTPException(422, "attribute names can't be empty")
    if len(set(names)) != len(names):
        raise HTTPException(422, "attribute names must be unique")
    v.product_name = body.product_name
    v.attributes = [a.model_copy(update={"name": a.name.strip()}) for a in body.attributes]
    store.save(p)
    return v


@app.delete("/api/products/{pid}/variants/{vid}", status_code=204)
def delete_variant(pid: str, vid: str) -> None:
    p = _product(pid)
    _variant(p, vid)
    p.variants = [v for v in p.variants if v.variant_id != vid]
    store.file_path(pid, vid).unlink(missing_ok=True)
    store.save(p)


@app.get("/api/products/{pid}/variants/{vid}/file")
def variant_file(pid: str, vid: str) -> FileResponse:
    """The original uploaded PDF, served inline for the viewer."""
    p = _product(pid)
    v = _variant(p, vid)
    return FileResponse(store.file_path(pid, vid), media_type="application/pdf",
                        content_disposition_type="inline", filename=v.source_file)


# ---- personas -----------------------------------------------------------------

@app.get("/api/personas")
def list_personas() -> list[Persona]:
    """The persona panel every run uses (data/personas.json): generated + interview personas."""
    return load_personas()


def _ndjson(events) -> StreamingResponse:
    return StreamingResponse((json.dumps(e) + "\n" for e in events), media_type="application/x-ndjson")


@app.post("/api/personas/analyze/audio")
def analyze_interview_audio(file: UploadFile = File(...)) -> StreamingResponse:
    """Interview audio -> NDI transcript -> NDI extract, streamed as NDJSON events
    (stage / transcript / draft / error). Nothing is saved until POST /api/personas/drafts/{id}."""
    name = file.filename or "interview"
    if Path(name).suffix.lower() not in extract_persona.AUDIO_EXTS:
        raise HTTPException(422, f"unsupported file type; use one of {sorted(extract_persona.AUDIO_EXTS)}")
    return _ndjson(personas.analyze_audio(name, file.file.read()))


class TranscriptIn(BaseModel):
    text: str
    title: str | None = None   # optional label for where it came from, e.g. "Interview 3"


@app.post("/api/personas/analyze/transcript")
def analyze_interview_transcript(body: TranscriptIn) -> StreamingResponse:
    """A pasted interview transcript -> NDI extract, streamed like analyze/audio."""
    text = body.text.strip()
    if len(text) < 40:
        raise HTTPException(422, "transcript is too short")
    return _ndjson(personas.analyze_text(text, (body.title or "").strip() or None))


@app.post("/api/personas/drafts/{draft_id}", status_code=201)
def save_persona_draft(draft_id: str) -> Persona:
    """Save an analyzed draft as a new persona in the panel."""
    try:
        return personas.save_draft(draft_id)
    except KeyError:
        raise HTTPException(404, "draft not found (already saved or discarded)")


@app.delete("/api/personas/drafts/{draft_id}", status_code=204)
def discard_persona_draft(draft_id: str) -> None:
    personas.discard_draft(draft_id)


class PersonaIn(BaseModel):
    """Editable fields (all optional; send only what changes)."""
    label: str | None = None
    name: str | None = None
    age_band: str | None = None
    gender: str | None = None
    location_type: str | None = None
    region: str | None = None
    household: str | None = None
    income_band: str | None = None
    occupation: str | None = None
    tech_savviness: str | None = None
    shopping_style: str | None = None
    price_sensitivity: str | None = None
    priorities: list[str] | None = None
    dealbreakers: list[str] | None = None
    bio: str | None = None


@app.put("/api/personas/{pid}")
def update_persona(pid: str, body: PersonaIn) -> Persona:
    changes = body.model_dump(exclude_unset=True)
    if "label" in changes and not (changes["label"] or "").strip():
        raise HTTPException(422, "label can't be empty")
    try:
        return personas.update(pid, changes)
    except KeyError:
        raise HTTPException(404, f"persona {pid} not found")


@app.delete("/api/personas/{pid}", status_code=204)
def delete_persona(pid: str) -> None:
    try:
        personas.delete(pid)
    except KeyError:
        raise HTTPException(404, f"persona {pid} not found")
    except PermissionError as e:
        raise HTTPException(403, str(e))


@app.get("/api/personas/{pid}/audio")
def persona_audio(pid: str) -> FileResponse:
    try:
        return FileResponse(personas.audio_path(pid), content_disposition_type="inline")
    except KeyError:
        raise HTTPException(404, f"no audio for persona {pid}")


@app.get("/api/personas/{pid}/transcript")
def persona_transcript(pid: str) -> dict:
    """NDI transcript: {transcript: {speakers, segments[{kind,start_ms,end_ms,speaker,transcript}], duration_ms, peaks}, markdown}."""
    try:
        return personas.transcript(pid)
    except KeyError:
        raise HTTPException(404, f"no transcript for persona {pid}")


# ---- panel runs (Drex) ------------------------------------------------------

@app.post("/api/products/{pid}/runs", status_code=201)
async def create_run(pid: str, n: int | None = None, market: bool = True) -> dict:
    """Run every persona (or the first n) against every variant through Drex; save and return it.
    ~120 calls for 60 personas x 2 variants, a few seconds."""
    p = _product(pid)
    if len(p.variants) < 2:
        raise HTTPException(422, "need at least 2 variants to run the panel")
    try:
        run = await runs.create(p, n, use_market=market)
    except DrexError as e:
        raise HTTPException(502, str(e))
    if not run["decisions"]:
        raise HTTPException(502, f"every Drex call failed: {run['stats']['failures'][:1]}")
    return run


@app.post("/api/products/{pid}/runs/stream")
async def create_run_stream(pid: str, n: int | None = None, market: bool = True) -> StreamingResponse:
    """Like POST /runs, but streams NDJSON progress events (one per decision) and ends with the run id."""
    p = _product(pid)
    if len(p.variants) < 2:
        raise HTTPException(422, "need at least 2 variants to run the panel")
    return StreamingResponse(runs.stream(p, n, use_market=market), media_type="application/x-ndjson")


@app.get("/api/products/{pid}/runs")
def list_runs(pid: str) -> list[dict]:
    _product(pid)
    return store.list_runs(pid)


@app.get("/api/products/{pid}/runs/latest")
def latest_run(pid: str) -> dict:
    _product(pid)
    rs = store.list_runs(pid)
    if not rs:
        raise HTTPException(404, "no runs yet")
    return runs.get(pid, rs[0]["id"])


@app.get("/api/products/{pid}/runs/{run_id}")
def get_run(pid: str, run_id: str) -> dict:
    _product(pid)
    try:
        return runs.get(pid, run_id)
    except KeyError:
        raise HTTPException(404, f"run {run_id} not found")


# ---- benchmarks (Drex vs LLM on the same panel) ------------------------------

@app.get("/api/benchmarks")
def list_benchmarks() -> list[dict]:
    return benchmarks.list_all()


@app.post("/api/benchmarks/stream")
async def run_benchmark(product: str, n: int | None = None, repeat: int = 2) -> StreamingResponse:
    """Run Drex and the LLM over the persona panel x this product's variants. Streams NDJSON progress
    and ends with {"type":"done","id":...}; the result is then at GET /api/benchmarks/{id}."""
    p = _product(product)
    if len(p.variants) < 2:
        raise HTTPException(400, "a benchmark needs a product with at least 2 variants")
    if n is not None and n < 1:
        raise HTTPException(400, "n must be at least 1")
    return StreamingResponse(benchmarks.stream(p.name, p.variants, n, repeat, p.id), media_type="application/x-ndjson")


@app.get("/api/benchmarks/{bid}")
def get_benchmark(bid: str) -> dict:
    try:
        return benchmarks.get(bid)
    except KeyError:
        raise HTTPException(404, f"benchmark {bid} not found")


# ---- market intelligence (Keenable live web research) ------------------------

@app.get("/api/products/{pid}/market")
def get_market(pid: str) -> dict:
    _product(pid)
    m = store.load_market(pid)
    if not m:
        raise HTTPException(404, "no market research yet")
    return m.model_dump()


@app.get("/api/products/{pid}/market/status")
def market_status(pid: str) -> dict:
    """Background research job started by a test run: {status: idle|running|done|error, step, steps, error}."""
    from .market import jobs
    _product(pid)
    return jobs.status(pid)


@app.post("/api/products/{pid}/market", status_code=201)
async def build_market(pid: str) -> dict:
    """Research the live market for this product with Keenable (~9 requests) and an LLM (~30-60 s)."""
    from .market import intel
    from .market.keenable_client import KeenableError
    from .model.llm_client import LLMError
    p = _product(pid)
    if not p.variants:
        raise HTTPException(422, "upload at least one variant first")
    try:
        m = await intel.build(p)
    except (KeenableError, LLMError) as e:
        raise HTTPException(502, str(e))
    store.save_market(pid, m)
    return m.model_dump()


# ---- what-if scenarios on top of market intelligence --------------------------

class ScenarioIn(BaseModel):
    scenario: dict = {}
    group_by: str = "shopping_style"


@app.post("/api/products/{pid}/scenario")
async def run_scenario(pid: str, body: ScenarioIn) -> dict:
    """Apply a what-if scenario and run the panel through Drex (cached; first run ~5 s).
    Returns the scenario and the baseline (today's market) so the UI can animate the difference."""
    from .market import scenario as scn
    p = _product(pid)
    intel = store.load_market(pid)
    if not intel:
        raise HTTPException(422, "research the market first")
    if len(p.variants) < 2:
        raise HTTPException(422, "need at least 2 variants")
    sc = scn.Scenario(**body.scenario)
    personas = load_personas()
    vids = [v.variant_id for v in p.variants]
    try:
        base_d = await scn.run(personas, p.variants, intel, scn.Scenario(target_variant=sc.target_variant))
        cur_d = base_d if sc.is_baseline() else await scn.run(personas, p.variants, intel, sc)
    except DrexError as e:
        raise HTTPException(502, str(e))
    if not cur_d:
        raise HTTPException(502, "every Drex call failed")
    base, cur = scn.summarize(base_d, personas, vids), scn.summarize(cur_d, personas, vids)
    by_topic: dict[str, list] = {}
    for s in intel.sources:
        by_topic.setdefault(s["topic"], []).append(s)
    return {
        "scenario": sc.model_dump(),
        "variants": [{"variant_id": v.variant_id, "name": v.product_name, "price": scn.variant_price(v)}
                     for v in scn.apply_variants(p.variants, sc)],
        "current": cur,
        "baseline": base,
        "explanation": scn.explain(sc, cur, base, personas, body.group_by),
        "personas": [{"id": x.id, "label": x.label, "group": getattr(x, body.group_by, "")} for x in personas],
        "market": {
            "category": intel.category, "created_at": intel.created_at,
            "competitors": [c.model_dump() for c in intel.competitors],
            "price_range": intel.price_range, "complaints": intel.complaints,
            "common_features": intel.common_features, "gaps": intel.gaps,
            "sources": by_topic,
        },
    }
