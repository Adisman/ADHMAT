# ADHMAT website

Prototype website for the Africa Digital Health Maturity Assessment Tool (ADHMAT), Africa CDC.

- Static site, no build step. Open `index.html` or serve the folder with any web server.
- Pages: Home, About, The tool, Roadmap, Dashboards, FAQ.
- `app/national-dashboard.html`: the National Dashboard (reads a REDCap CSV in the browser). Loads Chart.js and PapaParse from cdnjs.
- `app/continental-insights.html`: State of Digital Health continental dashboard. **Sample data only.**
- Do not commit assessment workbooks, country data or patient-level data to this public repository.

## Publish with GitHub Pages
Settings > Pages > Source: Deploy from a branch > `main` / root.

## Custom domain
Ask Africa CDC IT for a subdomain of the official domain (for example `adhmat.africacdc.org`), add a `CNAME` file containing it, and create a DNS CNAME record pointing to `adisman.github.io`.
