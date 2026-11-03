#!/usr/bin/env python3
"""Daily collector for the Hamilton Air Monitoring Network (HAMN).

Source: https://newreporting.hamnair.ca, the public HAMN reporting portal. The
portal's own pages call a few JSON "page methods" and this collector makes the
same public calls, with no sign-in:

  1. GET  /                                          starts a session (cookie)
  2. POST /ChartDataQueryHelper.aspx/InitSelectedDateTime
         {"sdate": "Nov/02/2026", "hour": 23}         picks the end of the window
  3. POST /ChartDataQueryHelper.aspx/GetSelectedChartData
         {"parameterTitle": "NO2"}                    that parameter, all stations

Step 3 answers with a 25-point hourly window ending at the chosen date and hour,
one value per station in the order of the response's "colDef" list. The session
remembers the chosen window, so step 2 must come first and the calls run one at a
time.

Time stamps are hour-ending local (EST/EDT) clock times, the way the portal
shows them. They are stored as they come: the value stamped 01:00 goes in the
h01 column. Air Quality Ontario labels its hours differently, so the two sources
can differ by one hour in labelling.

Storage: data/hamn.csv, one row per (date, station, parameter) with 24 hourly
columns, blank = no reading. Same layout as data/readings.csv.

Usage:
    python collector/collect_hamn.py                # last 5 days (daily job)
    python collector/collect_hamn.py --days 30      # backfill
"""

import argparse
import csv
import datetime as dt
import json
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

BASE = "https://newreporting.hamnair.ca"
METHOD_URL = BASE + "/ChartDataQueryHelper.aspx/{}"
TZ = ZoneInfo("America/Toronto")
USER_AGENT = "hamilton-air-dashboard/1.0 (personal air quality analytics)"

# portal parameter title -> id stored in the CSV
PARAMETERS = {
    "SO2": "SO2", "TRS": "TRS", "CO": "CO", "NO": "NO", "NO2": "NO2", "NOX": "NOX",
    "O3": "O3", "Benzene": "Benzene", "PM2.5": "PM25", "PM10": "PM10",
    "AT": "AT", "BP": "BP", "Rain": "Rain", "RH": "RH",
    "WSMx": "WSMx", "WS": "WS", "WD": "WD",
}
PARAMETER_ORDER = list(PARAMETERS.values())

HOUR_FIELDS = [f"h{h:02d}" for h in range(24)]
FIELDS = ["date", "station_id", "pollutant"] + HOUR_FIELDS
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def portal_date(day):
    """Date in the format the portal expects, e.g. Nov/02/2026 (always English)."""
    return f"{MONTHS[day.month - 1]}/{day.day:02d}/{day.year}"


def clean_value(text):
    text = text.strip()
    if not text:
        return ""
    try:
        float(text)
    except ValueError:
        return ""
    return text


def parse_chart(payload, parameter_id):
    """Turn one GetSelectedChartData response into {(iso_date, station): [24 values]}.

    Each point is stamped with its own date and hour; points of the same day
    land in the same 24-slot row. Points whose value count does not match the
    station list are skipped.
    """
    d = payload["d"] if "d" in payload else payload
    stations = [c["station"] for c in d["colDef"]]
    rows = {}
    for point in d["colection"]:
        stamp = dt.datetime.fromtimestamp(point["date"] / 1000, dt.timezone.utc)
        values = point["values"].split(",")
        if len(values) != len(stations):
            continue
        for station, text in zip(stations, values):
            row = rows.setdefault((stamp.date().isoformat(), station), [""] * 24)
            row[stamp.hour] = clean_value(text)
    return rows


class Portal:
    def __init__(self, sleep=0.3):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.sleep = sleep

    def start(self):
        self.session.get(BASE + "/", timeout=30).raise_for_status()

    def call(self, method, body, retries=3):
        last = None
        for attempt in range(retries):
            try:
                resp = self.session.post(
                    METHOD_URL.format(method), data=json.dumps(body),
                    headers={"Content-Type": "application/json; charset=utf-8"}, timeout=30)
                resp.raise_for_status()
                payload = resp.json()
                time.sleep(self.sleep)
                return payload
            except (requests.RequestException, ValueError) as err:
                last = err
                time.sleep(2 ** (attempt + 1))
        raise RuntimeError(f"{method} {body}: {last}")

    def window(self, day):
        """Choose the 25-hour window that ends at 23:00 on `day`."""
        self.call("InitSelectedDateTime", {"sdate": portal_date(day), "hour": 23})

    def chart(self, title):
        return self.call("GetSelectedChartData", {"parameterTitle": title})


def load_existing(path):
    data = {}
    if not path.exists():
        return data
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            data[(row["date"], row["station_id"], row["pollutant"])] = [row[f] for f in HOUR_FIELDS]
    return data


def merge(data, parameter_id, rows):
    """Newer non-blank values win; a blank never erases a stored value."""
    changed = 0
    for (date_text, station), values in rows.items():
        key = (date_text, station, parameter_id)
        current = data.get(key, [""] * 24)
        merged = [new if new != "" else old for old, new in zip(current, values)]
        if merged != current:
            changed += 1
        data[key] = merged
    return changed


def write_data(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    order = {p: i for i, p in enumerate(PARAMETER_ORDER)}
    keys = sorted(data, key=lambda k: (k[0], k[1], order.get(k[2], 99)))
    with path.open("w", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(FIELDS)
        for key in keys:
            writer.writerow(list(key) + data[key])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--data", default="data/hamn.csv", type=Path)
    parser.add_argument("--days", default=5, type=int, help="how many past days to (re-)fetch")
    parser.add_argument("--sleep", default=0.3, type=float, help="seconds between calls")
    args = parser.parse_args(argv)

    today = dt.datetime.now(TZ).date()
    portal = Portal(args.sleep)
    portal.start()

    data = load_existing(args.data)
    ok = failed = changed = 0
    # The window for day D holds the stamps D 00:00 through D+1 00:00, so
    # walking back one day at a time covers every hour of every day.
    for back in range(args.days):
        day = today - dt.timedelta(days=back)
        try:
            portal.window(day)
        except RuntimeError as err:
            failed += len(PARAMETERS)
            print(f"WARN  {err}", file=sys.stderr)
            continue
        for title, parameter_id in PARAMETERS.items():
            try:
                rows = parse_chart(portal.chart(title), parameter_id)
            except (RuntimeError, KeyError, TypeError) as err:
                failed += 1
                print(f"WARN  {day} {title}: {err}", file=sys.stderr)
            else:
                ok += 1
                changed += merge(data, parameter_id, rows)

    if ok == 0:
        print("ERROR no requests succeeded; data file left unchanged", file=sys.stderr)
        return 2
    write_data(args.data, data)
    print(f"Fetched {ok} series-windows ({failed} failed); {changed} day-rows added or updated; "
          f"{len(data)} day-rows stored in {args.data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
