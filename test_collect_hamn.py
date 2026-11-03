import csv
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import collect_hamn as c

FIX = Path(__file__).parent / "fixtures" / "hamn_chart.json"


class HamnTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads(FIX.read_text())

    def test_parse_places_values_by_stamp_hour(self):
        rows = c.parse_chart(self.payload, "SO2")
        stn = rows[("2026-11-01", "STN29667")]
        self.assertEqual(stn[14], "27")
        self.assertEqual(stn[15], "80")
        self.assertEqual(stn[0], "0")
        self.assertEqual(len(stn), 24)

    def test_parse_blank_and_non_numeric_become_missing(self):
        rows = c.parse_chart(self.payload, "SO2")
        self.assertEqual(rows[("2026-11-01", "COH_MBL1")][16], "")
        self.assertEqual(rows[("2026-11-01", "STN29667")][16], "")
        self.assertEqual(rows[("2026-11-01", "STN29102 Beach Blvd")][16], "1")

    def test_parse_skips_points_with_wrong_value_count(self):
        self.payload["d"]["colection"].append({"date": 1793552400000, "values": "1,2"})
        rows = c.parse_chart(self.payload, "SO2")
        self.assertEqual(rows[("2026-11-01", "STN29667")][17], "")

    def test_points_split_across_days(self):
        self.payload["d"]["colection"].append({"date": 1793577600000, "values": "9,9,9"})  # Nov 2 00:00
        rows = c.parse_chart(self.payload, "SO2")
        self.assertEqual(rows[("2026-11-02", "COH_MBL1")][0], "9")

    def test_merge_new_wins_blank_never_erases(self):
        data = {("2026-11-01", "STN29667", "SO2"): ["5"] + [""] * 23}
        rows = {("2026-11-01", "STN29667"): ["", "7"] + [""] * 22}
        changed = c.merge(data, "SO2", rows)
        self.assertEqual(changed, 1)
        self.assertEqual(data[("2026-11-01", "STN29667", "SO2")][:3], ["5", "7", ""])
        self.assertEqual(c.merge(data, "SO2", rows), 0)

    def test_round_trip_and_order(self):
        data = {}
        for p in ("PM25", "SO2"):
            c.merge(data, p, c.parse_chart(self.payload, p))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hamn.csv"
            c.write_data(path, data)
            self.assertEqual(c.load_existing(path), data)
            with path.open() as fh:
                header = next(csv.reader(fh))
            self.assertEqual(header, c.FIELDS)
            pols = [r["pollutant"] for r in csv.DictReader(path.open())]
            self.assertEqual(pols[:2], ["SO2", "PM25"])

    def test_portal_date_is_english_and_padded(self):
        self.assertEqual(c.portal_date(dt.date(2026, 11, 2)), "Nov/02/2026")
        self.assertEqual(c.portal_date(dt.date(2026, 5, 15)), "May/15/2026")

    def test_parameter_ids(self):
        self.assertEqual(c.PARAMETERS["PM2.5"], "PM25")
        self.assertEqual(len(set(c.PARAMETERS.values())), len(c.PARAMETERS))

    def test_seed_file_is_well_formed(self):
        data = c.load_existing(Path(__file__).parent.parent / "data" / "hamn.csv")
        self.assertGreater(len(data), 100)
        for (d, station, pol), vals in data.items():
            self.assertEqual(len(vals), 24)
            self.assertIn(pol, c.PARAMETER_ORDER)
            dt.date.fromisoformat(d)


if __name__ == "__main__":
    unittest.main()
