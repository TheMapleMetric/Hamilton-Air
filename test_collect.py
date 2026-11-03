import csv
import datetime as dt
import tempfile
import unittest
from pathlib import Path

import collect

FIXTURE = Path(__file__).parent / "fixtures" / "pollutant_table.html"


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.rows = collect.parse_table(FIXTURE.read_text())

    def test_three_days_of_24_values(self):
        self.assertEqual(sorted(self.rows), ["2026-10-31", "2026-11-01", "2026-11-02"])
        for values in self.rows.values():
            self.assertEqual(len(values), 24)

    def test_values_and_blank(self):
        self.assertEqual(self.rows["2026-10-31"][:3], ["4", "5", "5"])
        self.assertEqual(self.rows["2026-11-02"][17], "22")
        self.assertEqual(self.rows["2026-11-02"][23], "")  # hour not yet published

    def test_non_numeric_becomes_blank(self):
        self.assertEqual(collect.clean_value("N/A"), "")
        self.assertEqual(collect.clean_value(" 0.45 "), "0.45")
        self.assertEqual(collect.clean_value("-0.2"), "-0.2")

    def test_missing_table_raises(self):
        with self.assertRaises(ValueError):
            collect.parse_table("<html><body>maintenance</body></html>")


class MergeTests(unittest.TestCase):
    def test_new_values_win_but_blanks_never_erase(self):
        data = {("2026-11-02", "29000", "PM25"): ["1"] * 23 + [""]}
        rows = {"2026-11-02": ["2"] * 22 + [""] + ["9"]}
        changed = collect.merge(data, "29000", "PM25", rows)
        merged = data[("2026-11-02", "29000", "PM25")]
        self.assertEqual(changed, 1)
        self.assertEqual(merged[0], "2")      # corrected value replaced old
        self.assertEqual(merged[22], "1")     # blank did not erase stored value
        self.assertEqual(merged[23], "9")     # newly published hour filled in

    def test_round_trip_and_sort_order(self):
        data = {}
        collect.merge(data, "29118", "NO2", {"2026-11-01": ["1"] * 24})
        collect.merge(data, "29000", "SO2", {"2026-11-01": ["2"] * 24})
        collect.merge(data, "29000", "O3", {"2026-10-31": ["3"] * 24})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "readings.csv"
            collect.write_data(path, data)
            reloaded = collect.load_existing(path)
            self.assertEqual(reloaded, data)
            with path.open() as fh:
                keys = [(r["date"], r["station_id"], r["pollutant"]) for r in csv.DictReader(fh)]
        self.assertEqual(keys, [("2026-10-31", "29000", "O3"),
                                ("2026-11-01", "29000", "SO2"),
                                ("2026-11-01", "29118", "NO2")])


class WindowTests(unittest.TestCase):
    def test_windows_tile_without_gaps(self):
        today = dt.date(2026, 11, 2)
        starts = collect.window_starts(9, today)
        self.assertEqual(starts[0], None)                 # latest: Oct 31 - Nov 2
        self.assertEqual(starts[1], dt.date(2026, 10, 28))  # Oct 28 - Oct 30
        self.assertEqual(starts[2], dt.date(2026, 10, 25))  # Oct 25 - Oct 27
        self.assertEqual(len(starts), 3)

    def test_url(self):
        url = collect.build_url("29000", "PM25", dt.date(2026, 10, 28))
        self.assertIn("stationid=29000", url)
        self.assertIn("pol_code=124", url)
        self.assertIn("start_day=28&start_month=10&start_year=2026", url)
        self.assertIn("start_day=0&start_month=0&start_year=0",
                      collect.build_url("29000", "PM25", None))


if __name__ == "__main__":
    unittest.main()
