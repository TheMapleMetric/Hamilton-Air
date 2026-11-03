#!/usr/bin/env python3
"""Daily collector for Hamilton air-quality data.

Source: Air Quality Ontario (Ontario Ministry of the Environment, Conservation
and Parks) hourly pollutant tables for the three Hamilton stations.

Each request returns a table covering a three-day window: one row per date,
24 hourly columns (12AM..11PM, local time). Values are unvalidated when first
published and may be corrected later, so every run re-fetches the last few
days and overwrites older values with the newer ones.

Storage: data/readings.csv, one row per (date, station, pollutant) with 24
hourly columns. Blank = no reading.

Usage:
    python collector/collect.py                 # last 9 days (daily job)
    python collector/collect.py --days 365      # backfill roughly a year
"""

import argparse
import csv
import datetime as dt
import math
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://airqualityontario.com/aqhi/chart.php"
TZ = ZoneInfo("America/Toronto")
USER_AGENT = "hamilton-air-dashboard/1.0 (personal air quality analytics)"
WINDOW_DAYS = 3  # each table covers three days

POLLUTANT_CODES = {"O3": 122, "PM25": 124, "NO2": 36, "SO2": 9, "CO": 46}
POLLUTANT_ORDER = list(POLLUTANT_CODES)

# station id -> (name, pollutants it measures)
STATIONS = {
    "29000": ("Hamilton Downtown", ["O3", "PM25", "NO2", "SO2", "CO"]),
    "29214": ("Hamilton Mountain", ["O3", "PM25", "NO2", "SO2"]),
    "29118": ("Hamilton West", ["O3", "PM25", "NO2"]),
}

HOUR_FIELDS = [f"h{h:02d}" for h in range(24)]
FIELDS = ["date", "station_id", "pollutant"] + HOUR_FIELDS


def build_url(station_id, pollutant, start):
    """start is a date, or None for the most recent window."""
    d, m, y = (0, 0, 0) if start is None else (start.day, start.month, start.year)
    return (
        f"{BASE_URL}?stationid={station_id}&pol_code={POLLUTANT_CODES[pollutant]}"
        f"&start_day={d}&start_month={m}&start_year={y}"
        f"&showType=table&target_url=/history/pollutant.php"
    )


def clean_value(text):
    """Keep numeric strings as published; anything else is a missing reading."""
    text = text.strip()
    if not text:
        return ""
    try:
        float(text)
    except ValueError:
        return ""
    return text


def parse_table(html):
    """Parse one response into {iso_date: [24 value strings]}."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if table is None:
        raise ValueError("no <table> in response")
    rows = {}
    for tr in table.find_all("tr"):
        th = tr.find("th")
        tds = tr.find_all("td")
        if th is None or len(tds) != 24:
            continue
        date_text = th.get_text(strip=True)
        try:
            dt.date.fromisoformat(date_text)
        except ValueError:
            continue
        rows[date_text] = [clean_value(td.get_text()) for td in tds]
    if not rows:
        raise ValueError("table had no data rows")
    return rows


def fetch_window(session, station_id, pollutant, start, retries=3):
    url = build_url(station_id, pollutant, start)
    last_err = None
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
            return parse_table(resp.text)
        except (requests.RequestException, ValueError) as err:
            last_err = err
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"{station_id}/{pollutant} start={start}: {last_err}")


def load_existing(path):
    data = {}
    if not path.exists():
        return data
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            key = (row["date"], row["station_id"], row["pollutant"])
            data[key] = [row[f] for f in HOUR_FIELDS]
    return data


def merge(data, station_id, pollutant, rows):
    """Newer non-blank values win; a blank never erases a stored value."""
    changed = 0
    for date_text, values in rows.items():
        key = (date_text, station_id, pollutant)
        current = data.get(key, [""] * 24)
        merged = [new if new != "" else old for old, new in zip(current, values)]
        if merged != current:
            changed += 1
        data[key] = merged
    return changed


def write_data(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    order = {p: i for i, p in enumerate(POLLUTANT_ORDER)}
    keys = sorted(data, key=lambda k: (k[0], k[1], order.get(k[2], 99)))
    with path.open("w", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(FIELDS)
        for key in keys:
            writer.writerow(list(key) + data[key])


def window_starts(days, today):
    """Start dates for each window; None means 'most recent window'."""
    count = max(1, math.ceil(days / WINDOW_DAYS))
    starts = [None]
    for k in range(1, count):
        starts.append(today - dt.timedelta(days=WINDOW_DAYS - 1 + WINDOW_DAYS * k))
    return starts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--data", default="data/readings.csv", type=Path)
    parser.add_argument("--days", default=9, type=int,
                        help="how many past days to (re-)fetch")
    parser.add_argument("--sleep", default=1.0, type=float,
                        help="seconds to wait between requests")
    args = parser.parse_args(argv)

    today = dt.datetime.now(TZ).date()
    starts = window_starts(args.days, today)
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    data = load_existing(args.data)
    ok = failed = changed = 0
    for station_id, (name, pollutants) in STATIONS.items():
        for pollutant in pollutants:
            for start in starts:
                try:
                    rows = fetch_window(session, station_id, pollutant, start)
                except RuntimeError as err:
                    failed += 1
                    print(f"WARN  {err}", file=sys.stderr)
                else:
                    ok += 1
                    changed += merge(data, station_id, pollutant, rows)
                time.sleep(args.sleep)

    if ok == 0:
        print("ERROR no requests succeeded; data file left unchanged", file=sys.stderr)
        return 2
    write_data(args.data, data)
    print(f"Fetched {ok} windows ({failed} failed); {changed} day-rows added or updated; "
          f"{len(data)} day-rows stored in {args.data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
