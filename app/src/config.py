import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")


DATA_DIR = ROOT / "data"
PERSONAS_PATH = DATA_DIR / "personas.json"
CACHE_DIR = DATA_DIR / "cache"
RUNS_DIR = DATA_DIR / "runs"

NACE_API_KEY = os.getenv("NACE_API_KEY", "")
DREX_BASE_URL = os.getenv("DREX_BASE_URL", "https://console.nace.ai")
DREX_MODEL = os.getenv("DREX_MODEL", "drex-latest")

NDI_API_KEY = os.getenv("NDI_API_KEY", "")
NDI_BASE_URL = os.getenv("NDI_BASE_URL", "https://ndi-api.nace.ai")

BUY_THRESHOLD = float(os.getenv("BUY_THRESHOLD", "0.5"))
LOW_CONFIDENCE = float(os.getenv("LOW_CONFIDENCE", "0.6"))
DREX_CONCURRENCY = int(os.getenv("DREX_CONCURRENCY", "8"))
MOCK_DREX = _bool("MOCK_DREX")
MOCK_NDI = _bool("MOCK_NDI")
