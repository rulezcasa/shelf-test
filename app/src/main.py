"""HTTP API for the webapp. Run from app/:  uvicorn src.main:app --reload --port 8000

Products hold variants; uploading a variant document stores the original PDF and extracts it
with NDI right away. Extracted fields can be edited and saved back.
"""
import string
import threading
from collections import defaultdict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .models import Attribute, Persona, Product, Variant
from .ndi.extract_variants import extract_variant
from .ndi.ndi_client import NDIError

from .api import runs, store
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
    """The persona panel every run uses (data/personas.json)."""
    return load_personas()


# ---- panel runs (Drex) ------------------------------------------------------

@app.post("/api/products/{pid}/runs", status_code=201)
async def create_run(pid: str, n: int | None = None) -> dict:
    """Run every persona (or the first n) against every variant through Drex; save and return it.
    ~120 calls for 60 personas x 2 variants, a few seconds."""
    p = _product(pid)
    if len(p.variants) < 2:
        raise HTTPException(422, "need at least 2 variants to run the panel")
    try:
        run = await runs.create(p, n)
    except DrexError as e:
        raise HTTPException(502, str(e))
    if not run["decisions"]:
        raise HTTPException(502, f"every Drex call failed: {run['stats']['failures'][:1]}")
    return run


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
