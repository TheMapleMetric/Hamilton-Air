import unittest
from pathlib import Path

import collect_news as n

FIX = Path(__file__).parent / "fixtures" / "police_feed.xml"


class NewsTests(unittest.TestCase):
    def test_parse_keeps_only_headline_date_link(self):
        items = n.parse_feed(FIX.read_bytes())
        self.assertEqual(len(items), 2)
        self.assertEqual(set(items[0]), {"title", "link", "published"})
        self.assertEqual(items[0]["published"], "2026-11-06T15:20:00Z")  # EST -> UTC
        self.assertNotIn("release text", str(items))

    def test_parse_skips_offsite_and_bad_dates(self):
        links = [i["link"] for i in n.parse_feed(FIX.read_bytes())]
        self.assertTrue(all(l.startswith("https://hamiltonpolice.on.ca/") for l in links))

    def test_merge_dedupes_sorts_and_caps(self):
        old = [{"title": "Old", "link": "https://hamiltonpolice.on.ca/news/a/", "published": "2026-10-01T00:00:00Z"}]
        new = n.parse_feed(FIX.read_bytes()) + [{"title": "Old edited", "link": old[0]["link"], "published": "2026-10-01T00:00:00Z"}]
        merged = n.merge(old, new)
        self.assertEqual([i["published"][:10] for i in merged], ["2026-11-06", "2026-11-05", "2026-10-01"])
        self.assertEqual(merged[-1]["title"], "Old edited")
        many = [{"title": str(k), "link": f"https://hamiltonpolice.on.ca/news/{k}/", "published": f"2026-01-01T00:{k % 60:02d}:00Z"} for k in range(100)]
        self.assertEqual(len(n.merge([], many)), n.MAX_ITEMS)


if __name__ == "__main__":
    unittest.main()
