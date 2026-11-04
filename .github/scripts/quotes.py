"""Сбор котировок для раздела «Рынки».

Источник отдаёт поля ask/bid перепутанными (ask меньше bid), поэтому
меньшую цену пишем как bid, большую как ask. Если источник ответил
ошибкой или пустым списком, старый файл не трогаем.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://online.npbfxrus.pro/wp-admin/admin-ajax.php?action=trader_quotes_proxy"
OUT = Path(__file__).resolve().parents[2] / "data" / "quotes.json"


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (perfex quotes)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = json.loads(r.read().decode("utf-8"))

    quotes = {}
    for sym, q in raw.items():
        try:
            a, b = q["ask"], q["bid"]
            lo, hi = (a, b) if float(a) <= float(b) else (b, a)
        except (KeyError, TypeError, ValueError):
            continue
        quotes[sym] = {"bid": lo, "ask": hi}

    if len(quotes) < 40:
        print(f"слишком мало котировок: {len(quotes)}, файл не меняю")
        sys.exit(1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "quotes": quotes}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"записано {len(quotes)} котировок")


if __name__ == "__main__":
    main()
