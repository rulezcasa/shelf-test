import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent          # app/
load_dotenv(ROOT.parent / ".env")                       # keys live in shelf-test/.env


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")


DATA_DIR = ROOT / "data"
PERSONAS_PATH = DATA_DIR / "personas.json"
CACHE_DIR = DATA_DIR / "cache"
RUNS_DIR = DATA_DIR / "runs"

NACE_API_KEY = os.getenv("NACE_API_KEY", "")
DREX_BASE_URL = os.getenv("DREX_BASE_URL", "https://console.nace.ai")
DREX_MODEL = os.getenv("DREX_MODEL", "drex-latest")

# NDI goes through the console with the same key as Drex
NACE_BASE_URL = os.getenv("NACE_BASE_URL", "https://console.nace.ai")


BUY_THRESHOLD = float(os.getenv("BUY_THRESHOLD", "0.6"))        # p_buy >= this -> "buy"
CONSIDER_THRESHOLD = float(os.getenv("CONSIDER_THRESHOLD", "0.35"))  # >= this -> "consider", else "reject"
LOW_CONFIDENCE = float(os.getenv("LOW_CONFIDENCE", "0.6"))
DREX_CONCURRENCY = int(os.getenv("DREX_CONCURRENCY", "8"))
