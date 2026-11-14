"""Customer-interview audio -> Persona fields, via NDI.

1. upload the audio and Parse it -> transcript (speakers + timed segments + markdown)
2. NDI Extract doesn't accept audio, so the transcript markdown is uploaded as a document
   and Extract runs on that with the Persona schema.

Fields the interviewee doesn't mention stay empty: no guessing.
"""
import tempfile
from pathlib import Path

from . import ndi_client

AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
GENDERS = ["female", "male", "nonbinary"]
LOCATIONS = ["urban", "suburban", "rural"]
REGIONS = ["US-West", "US-South", "US-Midwest", "US-Northeast"]
HOUSEHOLDS = ["single", "couple", "family_with_kids", "retiree", "roommates"]
INCOMES = ["<35k", "35-75k", "75-150k", "150k+"]
LEVELS = ["low", "medium", "high"]
STYLES = ["bargain_hunter", "researcher", "brand_loyal", "impulse", "eco_conscious", "convenience_first"]
PRIORITIES = ["price", "quality", "durability", "convenience", "sustainability", "brand", "design", "support", "features"]
DEALBREAKERS = ["no free returns", "no warranty", "subscription required", "slow shipping", "poor reviews", "complicated setup"]

AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm", ".mp4", ".mov"}


def _enum(values: list[str]) -> dict:
    return {"type": ["string", "null"], "enum": values + [None]}


SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": ["string", "null"]},
        "age": {"type": ["integer", "null"]},
        "age_band": _enum(AGE_BANDS),
        "gender": _enum(GENDERS),
        "location_type": _enum(LOCATIONS),
        "region": _enum(REGIONS),
        "household": _enum(HOUSEHOLDS),
        "income_band": _enum(INCOMES),
        "occupation": {"type": ["string", "null"]},
        "tech_savviness": _enum(LEVELS),
        "shopping_style": _enum(STYLES),
        "price_sensitivity": _enum(["high", "medium", "low"]),
        "priorities": {"type": "array", "items": {"type": "string", "enum": PRIORITIES}},
        "dealbreakers": {"type": "array", "items": {"type": "string", "enum": DEALBREAKERS}},
        "bio": {"type": ["string", "null"]},
    },
}

INSTRUCTIONS = (
    "This is a transcript of a customer interview. Describe the INTERVIEWEE (the person answering questions), "
    "never the interviewer. Only fill a field when the interviewee clearly states it or it follows directly from "
    "what they say (e.g. a US city -> region, 'my husband and our two kids' -> family_with_kids, 'I'm 42' -> age 42 "
    "and age_band 35-44). If something is not mentioned, leave it null. Never guess: income_band only if they mention "
    "what they earn; gender only if they state it outright (never infer it from a name, voice or partner); "
    "tech_savviness only if they talk about their comfort with technology. "
    "priorities: up to 3 things they say matter most when buying. dealbreakers: only ones they say would stop them buying. "
    "bio: 2-3 sentences in third person summarising who they are and how they shop, using only what they said."
)


def transcribe(audio: Path) -> dict:
    """Upload + Parse. Returns {"transcript": {...speakers, segments, duration_ms, peaks}, "markdown": str}."""
    result = ndi_client.parse(ndi_client.upload(audio))
    return {"transcript": result.get("transcript") or {}, "markdown": (result.get("document") or {}).get("markdown") or ""}


def extract_fields(markdown: str, name_hint: str = "interview") -> dict:
    """Extract persona fields from transcript markdown (uploaded as a document)."""
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / f"{Path(name_hint).stem}-transcript.md"
        f.write_text(markdown)
        result = ndi_client.extract(ndi_client.upload(f), SCHEMA, INSTRUCTIONS)
    data = result.get("data") or {}
    return {k: data.get(k) for k in SCHEMA["properties"]}


def build_label(f: dict) -> str:
    """'42, suburban nurse, family with kids' from whatever is known; falls back to the name."""
    who = " ".join(x for x in [f.get("location_type"), f.get("occupation")] if x)
    parts = [str(f["age"]) if f.get("age") else None, who or None,
             (f.get("household") or "").replace("_", " ") or None]
    label = ", ".join(p for p in parts if p)
    return label or (f"{f['name']} (interview)" if f.get("name") else "Interviewee")
