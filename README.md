# Hamilton air quality dashboard

A free, self-updating dashboard of hourly air readings for Hamilton, from two
sources with a switch at the top of the page:

- **Ministry stations**: the three Ontario Ministry of the Environment stations
  (Downtown, Mountain, West): O₃, PM2.5, NO₂, SO₂ and CO. Not every station
  measures every pollutant: CO is Downtown only, and SO₂ is Downtown and Mountain.
- **HAMN stations**: the Hamilton Air Monitoring Network's 20 stations from its
  reporting portal (newreporting.hamnair.ca): SO₂, TRS, CO, NO, NO₂, NOₓ, O₃,
  benzene, PM2.5, PM10 and weather (temperature, humidity, pressure, wind, rain).
  Charts show up to three stations you pick; the tables cover all of them.

Link straight to a view with `#hamn` or `#ministry` on the end of the address.

```
index.html, dashboard.js    the dashboard (no build step, no libraries)
data/readings.csv           Ministry history; one row per day, station and pollutant
data/hamn.csv               HAMN history, same layout
collector/collect.py        downloads the Ministry readings and adds them to the CSV
collector/collect_hamn.py   does the same for HAMN
.github/workflows/collect.yml   runs the collector every morning on GitHub
```

The data files already hold real readings (Ministry: Oct 31 to Nov 2, 2026; HAMN: Nov 1 and 2),
so the dashboard works as soon as it is online.

## Set it up (about 10 minutes)

1. **Create a GitHub repository** (public, so Pages is free) and upload everything
   in this folder, including the hidden `.github` folder.
2. **Turn on the website:** Settings → Pages → "Deploy from a branch" → branch
   `main`, folder `/ (root)`. After a minute your dashboard is at
   `https://<your-username>.github.io/<repo-name>/`.
3. **Run the collector once by hand:** Actions tab → "Collect Hamilton air quality
   data" → Run workflow. Leave days at 9 for a first test, then check that the
   run is green and `data/readings.csv` and `data/hamn.csv` gained a commit. The
   two sources run as separate steps, so if one site refuses GitHub's servers the
   other still saves (the run then shows red).
4. **Backfill history (optional):** run the workflow again with days set to 90.
   The Ministry collector needs one request per three days per series
   (90 days is about 7 minutes). HAMN needs about 18 calls per day (90 days is
   roughly 10 to 20 minutes), so backfill it in moderate steps.
5. **Daily updates are automatic** from then on (around 6:15 AM Eastern). Each run
   re-fetches the last 9 days, because the Ministry corrects its readings after
   first publishing them.

## Show it on your beehiiv page

Link to the GitHub Pages address, or paste it into an embed or HTML block if your
beehiiv plan allows one. If an embed block refuses it, a button or link to the
dashboard always works.

## Things to know

- **The collector has not been run against the live site yet.** I confirmed the
  page format and station and pollutant codes in a browser, and the parsing is
  covered by tests, but the first real run happens on GitHub. If step 3 fails,
  open the failed run and read the log. The most likely causes are the site
  blocking GitHub's servers or the page layout changing.
- **Readings are unvalidated.** The Ministry publishes them automatically and
  may amend them later. Older days are only re-fetched when they fall inside the
  run's day window, so use a larger `days` value to refresh older periods.
- **HAMN data comes from the portal's public page methods.** The collector makes
  the same anonymous calls the portal's own pages make, one at a time, with a
  pause between them and an identifying User-Agent. I found no terms of use or
  data-download page for it. If you plan to publish this widely, it is worth
  asking HAMN that they are comfortable with it.
- **HAMN values are raw.** For example, one benzene reading of 449.5 µg/m³
  (RC West, Nov 2, 1 AM) is almost certainly an instrument spike. The dashboard
  shows what the portal publishes and does not filter it.
- **Hour labels differ by one hour between sources.** HAMN stamps each reading
  with the hour it ends and the collector stores that stamp as is.
- **Guidelines** shown are the Ontario 1-hour criteria listed by Air Quality
  Ontario (ozone 80 ppb, nitrogen dioxide 200 ppb, sulphur dioxide 40 ppb, carbon
  monoxide 30 ppm). Fine particles, and the HAMN-only pollutants (TRS, benzene, PM10, NO, NOₓ), have
  no guideline drawn because I could not confirm a matching 1-hour figure.

## Run the tests

```
python -m unittest discover -s collector -p "test_*.py"
node test_dashboard.js
```

To preview locally, run `python -m http.server` in this folder and open
http://localhost:8000.
