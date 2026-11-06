#!/usr/bin/env python3
"""Collect headlines from the Hamilton Police Service newsroom RSS feed.

Source: https://hamiltonpolice.on.ca/news/feed/en-ca (the police service's own
public feed). Only the headline, date and link are kept, never the release text,
images or names beyond what the headline itself says, so every item sends the
reader to the police website.

Output: data/police_news.json, newest first, capped at MAX_ITEMS.
"""

import argparse
import datetime as dt
import email.utils
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

FEED_URL = "https://hamiltonpolice.on.ca/news/feed/en-ca"
USER_AGENT = "hamilton-air-dashboard/1.0 (personal air quality analytics)"
MAX_ITEMS = 60


def parse_feed(xml_text):
    """Return [{title, link, published (UTC ISO)}] from RSS text."""
    root = ET.fromstring(xml_text)
    items = []
    for node in root.iter("item"):
        title = (node.findtext("title") or "").strip()
        link = (node.findtext("link") or "").strip()
        stamp = (node.findtext("pubDate") or "").strip()
        if not title or not link.startswith("https://hamiltonpolice.on.ca/"):
            continue
        try:
            when = email.utils.parsedate_to_datetime(stamp).astimezone(dt.timezone.utc)
        except (TypeError, ValueError):
            continue
        items.append({"title": title, "link": link,
                      "published": when.strftime("%Y-%m-%dT%H:%M:%SZ")})
    return items


def merge(existing, new):
    """Keep one entry per link (newest data wins), newest first, capped."""
    by_link = {i["link"]: i for i in existing}
    by_link.update({i["link"]: i for i in new})
    items = sorted(by_link.values(), key=lambda i: i["published"], reverse=True)
    return items[:MAX_ITEMS]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", default="data/police_news.json", type=Path)
    args = parser.parse_args(argv)

    resp = requests.get(FEED_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    new = parse_feed(resp.content)
    if not new:
        print("ERROR feed had no usable items; file left unchanged", file=sys.stderr)
        return 2
    existing = []
    if args.out.exists():
        existing = json.loads(args.out.read_text()).get("items", [])
    items = merge(existing, new)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "source": "Hamilton Police Service Newsroom",
        "source_url": "https://hamiltonpolice.on.ca/news",
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": items,
    }, indent=1) + "\n")
    print(f"{len(new)} items fetched; {len(items)} stored in {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
