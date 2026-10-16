"""Minimal Adzuna API client. Reads credentials from the environment only;
never logs or prints the key. Every call is counted in data/api_calls.log."""
import datetime, json, os, time
from pathlib import Path
import requests

BASE = "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"
ROOT = Path(__file__).resolve().parent.parent
CALL_LOG = ROOT / "data" / "api_calls.log"


class AdzunaError(Exception):
    pass


def _creds():
    app_id = os.environ.get("ADZUNA_APP_ID")
    app_key = os.environ.get("ADZUNA_APP_KEY")
    if not app_id or not app_key:
        raise AdzunaError("ADZUNA_APP_ID and ADZUNA_APP_KEY must be set in the environment")
    return app_id, app_key


def _redact(text, secret):
    return text.replace(secret, "***") if secret else text


def search(country, what_or, where=None, distance_km=None, page=1,
           results_per_page=50, max_days_old=30, label=""):
    app_id, app_key = _creds()
    params = {"app_id": app_id, "app_key": app_key,
              "results_per_page": results_per_page, "what_or": what_or,
              "max_days_old": max_days_old, "content-type": "application/json"}
    if where:
        params["where"] = where
    if distance_km:
        params["distance"] = distance_km
    url = BASE.format(country=country, page=page)
    CALL_LOG.parent.mkdir(exist_ok=True)
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    try:
        r = requests.get(url, params=params, timeout=30)
    except requests.RequestException as e:  # message may contain the URL -> redact
        with CALL_LOG.open("a") as f:
            f.write(f"{ts}\t{country}\t{label}\tERROR\n")
        raise AdzunaError(_redact(str(e), app_key)) from None
    with CALL_LOG.open("a") as f:
        f.write(f"{ts}\t{country}\t{label}\t{r.status_code}\n")
    if r.status_code != 200:
        raise AdzunaError(f"HTTP {r.status_code}: {_redact(r.text[:300], app_key)}")
    time.sleep(2.6)  # stay well under 25 calls/minute
    return r.json()
