import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent          # app/
load_dotenv(ROOT.parent / ".env")                       # keys live in shelf-test/.env


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")


DATA_DIR = ROOT / "data"
PERSONAS_PATH = DATA_DIR / "personas.json"
PERSONA_FILES_DIR = DATA_DIR / "personas"   # interview audio + transcripts, one folder per persona
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

# LLM decision model on DeepInfra (OpenAI-compatible), benchmarked against Drex
DEEPINFRA_API_KEY = os.getenv("DEEPINFRA_API_KEY", "")
DEEPINFRA_BASE_URL = os.getenv("DEEPINFRA_BASE_URL", "https://api.deepinfra.com/v1/openai")
LLM_MODEL = os.getenv("LLM_MODEL", "meta-llama/Llama-3.3-70B-Instruct-Turbo")
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))
LLM_CONCURRENCY = int(os.getenv("LLM_CONCURRENCY", "8"))
# USD per 1M tokens (input, output) for cost estimates; check deepinfra.com/pricing for your model
LLM_PRICE_IN = float(os.getenv("LLM_PRICE_IN", "0.23"))
LLM_PRICE_OUT = float(os.getenv("LLM_PRICE_OUT", "0.40"))

# Keenable (live web search + page retrieval for market intelligence). Without a key the
# keyless /public endpoints are used (1,000 req/h per IP); a free key gives 100k req/month.
KEENABLE_API_KEY = os.getenv("KEENABLE_API_KEY", "")
KEENABLE_BASE_URL = os.getenv("KEENABLE_BASE_URL", "https://api.keenable.ai")
