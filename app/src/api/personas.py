"""Persona panel store. All personas live in data/personas.json (the list every test runs);
interview personas also keep their audio + NDI transcript in data/personas/<id>/."""
import json
import re
import threading
import uuid
from collections.abc import Iterator
from pathlib import Path

from ..config import PERSONA_FILES_DIR, PERSONAS_PATH
from ..models import Persona
from ..ndi import extract_persona, ndi_client

_lock = threading.Lock()  # personas.json is read-modify-written


def load() -> list[Persona]:
    return [Persona(**p) for p in json.loads(PERSONAS_PATH.read_text())]


def _dump(p: Persona) -> dict:
    """Compact JSON: drop empty optional fields and the default source, so generated personas stay as written."""
    d = p.model_dump()
    for k in ("name", "source_file"):
        if d.get(k) is None:
            d.pop(k)
    if d.get("source") == "generated":
        d.pop("source")
    return d


def _save(personas: list[Persona]) -> None:
    PERSONAS_PATH.write_text(json.dumps([_dump(p) for p in personas], indent=2))  # same format as gen_personas.py


def get(pid: str) -> Persona:
    for p in load():
        if p.id == pid:
            return p
    raise KeyError(pid)


def _dir(pid: str) -> Path:
    if not re.fullmatch(r"P\d+", pid):
        raise KeyError(pid)
    return PERSONA_FILES_DIR / pid


def _next_id(personas: list[Persona]) -> str:
    n = max((int(p.id[1:]) for p in personas if re.fullmatch(r"P\d+", p.id)), default=0) + 1
    return f"P{n:03d}"


# ---- analyze (draft) -> save ------------------------------------------------------
# Analysis runs NDI and keeps the result as a draft in data/personas/_drafts/<draft_id>/.
# Nothing is added to the panel until save_draft().

DRAFTS_DIR = PERSONA_FILES_DIR / "_drafts"


def _draft_dir(draft_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", draft_id):
        raise KeyError(draft_id)
    return DRAFTS_DIR / draft_id


def _draft_persona(fields: dict, source_file: str | None) -> dict:
    """Preview of the persona the draft would become (id assigned on save)."""
    return Persona(
        id="draft",
        label=extract_persona.build_label(fields),
        source="interview",
        source_file=source_file,
        **{k: v for k, v in fields.items() if k in Persona.model_fields and v is not None},
    ).model_dump()


def _segments(t: dict) -> list[dict]:
    return [
        {"speaker": x.get("speaker"), "start_ms": x.get("start_ms"), "end_ms": x.get("end_ms"), "text": x.get("transcript") or ""}
        for x in (t.get("segments") or [])
        if x.get("kind") == "speech"
    ]


def analyze_audio(filename: str, data: bytes) -> Iterator[dict]:
    """Yields progress events while NDI transcribes + extracts; ends with a draft (or an error)."""
    name = Path(filename).name
    draft_id = uuid.uuid4().hex
    d = _draft_dir(draft_id)
    try:
        d.mkdir(parents=True)
        audio = d / name
        audio.write_bytes(data)
        yield {"type": "stage", "stage": "uploading"}
        src = ndi_client.upload(audio)
        yield {"type": "stage", "stage": "transcribing"}
        result = ndi_client.parse(src)
        t = result.get("transcript") or {}
        md = (result.get("document") or {}).get("markdown") or ""
        if not md.strip():
            raise ValueError("NDI returned an empty transcript")
        transcript = {"transcript": t, "markdown": md, "has_audio": True}
        yield {"type": "transcript", "segments": _segments(t), "duration_ms": t.get("duration_ms"), "peaks": t.get("peaks") or [], "markdown": md}
        yield {"type": "stage", "stage": "extracting"}
        fields = extract_persona.extract_fields(md, name)
        (d / "draft.json").write_text(json.dumps({"fields": fields, "transcript": transcript, "audio": name, "title": None}))
        yield {"type": "draft", "draft_id": draft_id, "persona": _draft_persona(fields, name)}
    except GeneratorExit:  # client went away mid-analysis: drop the half-made draft
        discard_draft(draft_id)
        raise
    except Exception as e:  # surfaced to the UI as-is
        discard_draft(draft_id)
        yield {"type": "error", "message": str(e)}


def analyze_text(text: str, title: str | None) -> Iterator[dict]:
    draft_id = uuid.uuid4().hex
    d = _draft_dir(draft_id)
    try:
        d.mkdir(parents=True)
        yield {"type": "transcript", "segments": [], "duration_ms": None, "peaks": [], "markdown": text}
        yield {"type": "stage", "stage": "extracting"}
        fields = extract_persona.extract_fields(text, title or "pasted-transcript")
        transcript = {"transcript": {}, "markdown": text, "has_audio": False}
        (d / "draft.json").write_text(json.dumps({"fields": fields, "transcript": transcript, "audio": None, "title": title}))
        yield {"type": "draft", "draft_id": draft_id, "persona": _draft_persona(fields, title)}
    except GeneratorExit:
        discard_draft(draft_id)
        raise
    except Exception as e:
        discard_draft(draft_id)
        yield {"type": "error", "message": str(e)}


def save_draft(draft_id: str) -> Persona:
    """Turn an analyzed draft into a persona in the panel."""
    d = _draft_dir(draft_id)
    f = d / "draft.json"
    if not f.exists():
        raise KeyError(draft_id)
    draft = json.loads(f.read_text())
    fields, audio = draft["fields"], draft.get("audio")
    with _lock:
        personas = load()
        pid = _next_id(personas)
        persona = Persona(
            id=pid,
            label=extract_persona.build_label(fields),
            source="interview",
            source_file=audio or draft.get("title"),
            **{k: v for k, v in fields.items() if k in Persona.model_fields and v is not None},
        )
        out = _dir(pid)
        out.mkdir(parents=True, exist_ok=True)
        if audio:
            (d / audio).rename(out / audio)
        (out / "transcript.json").write_text(json.dumps(draft["transcript"]))
        _save(personas + [persona])
    discard_draft(draft_id)
    return persona


def discard_draft(draft_id: str) -> None:
    try:
        d = _draft_dir(draft_id)
    except KeyError:
        return
    if d.exists():
        for x in d.iterdir():
            x.unlink()
        d.rmdir()


def update(pid: str, changes: dict) -> Persona:
    with _lock:
        personas = load()
        for i, p in enumerate(personas):
            if p.id == pid:
                merged = Persona(**{**p.model_dump(), **changes, "id": p.id, "source": p.source, "source_file": p.source_file})
                personas[i] = merged
                _save(personas)
                return merged
    raise KeyError(pid)


def delete(pid: str) -> None:
    """Interview personas only; the generated panel stays fixed."""
    with _lock:
        personas = load()
        p = next((x for x in personas if x.id == pid), None)
        if p is None:
            raise KeyError(pid)
        if p.source != "interview":
            raise PermissionError("only interview personas can be deleted")
        _save([x for x in personas if x.id != pid])
        d = _dir(pid)
        if d.exists():
            for f in d.iterdir():
                f.unlink()
            d.rmdir()


def audio_path(pid: str) -> Path:
    p = get(pid)
    if not p.source_file:
        raise KeyError(pid)
    f = _dir(pid) / Path(p.source_file).name  # never a path from user input
    if not f.is_file() or f.name == "transcript.json":
        raise KeyError(pid)
    return f


def transcript(pid: str) -> dict:
    f = _dir(pid) / "transcript.json"
    if not f.exists():
        raise KeyError(pid)
    return json.loads(f.read_text())

