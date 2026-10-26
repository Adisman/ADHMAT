# ADHMAT website

Prototype website for the Africa Digital Health Maturity Assessment Tool (ADHMAT), Africa CDC.

- Static site, no build step. Open `index.html` or serve the folder with any web server.
- Pages: Home, About, The tool, Roadmap, Dashboards, FAQ.
- `app/national-dashboard.html`: the National Dashboard (reads a REDCap CSV in the browser). Loads Chart.js and PapaParse from cdnjs.
- `app/continental-insights.html`: State of Digital Health continental dashboard. Opens with **generated test data**; the **Data** button imports a REDCap export (checked, then stored in the browser) and can follow a scheduled feed.
- `app/adhmat-core.js`, `app/adhmat-ui.js`, `app/adhmat-config.js`: importer and scoring, browser storage and feed polling, settings.
- `app/test-data/`: generated test files in REDCap export and feed formats.
- `pipeline/`: REDCap to feed script, scheduled-job template and README. See `pipeline/README.md`.
- `tests/`: `node tests/roundtrip.js`, `node tests/test_pipeline.mjs`.

> Real country results must not be committed to this public repository. Imported data stay in the visitor's browser; a shared feed must be hosted by Africa CDC.
- Do not commit assessment workbooks, country data or patient-level data to this public repository.

## Publish with GitHub Pages
Settings > Pages > Source: Deploy from a branch > `main` / root.

## Custom domain
Ask Africa CDC IT for a subdomain of the official domain (for example `adhmat.africacdc.org`), add a `CNAME` file containing it, and create a DNS CNAME record pointing to `adisman.github.io`.
