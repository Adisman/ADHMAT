# ADHMAT pipeline: REDCap to the dashboard

The dashboard (`app/continental-insights.html`) can be filled in three ways. All three produce exactly the same views.

| Route | Who uses it | Where the data live |
|---|---|---|
| **Test data** (built in) | Anyone, to check layout, filters and the scoring | Generated, labelled "Test data" |
| **REDCap file import** (Data button) | An analyst with a REDCap export | That person's browser only (IndexedDB) |
| **Scheduled feed** | Everyone who opens the dashboard | One feed file on a server; the dashboard polls it |

## 1. How the scheduled feed works

```
REDCap project ──API──▶ pipeline/redcap_to_feed.mjs ──▶ adhmat-feed.json ──▶ dashboard polls the URL
   (agreed timetable)      calculates scores with the          (HTTPS, CORS)     and refreshes when
                           same code as the dashboard                            generated_at changes
```

1. A scheduled job runs `redcap_to_feed.mjs` on the agreed timetable (for example every 6 hours, or nightly).
2. The script asks the REDCap API only for the fields the dashboard needs. Contact details, approval fields and free-text answers are never requested.
3. It checks the records, calculates sub-domain, domain and overall scores (ADHMAT V2.5 method) and writes **one** JSON file (`adhmat-feed/1`). If nothing changed since the last run, `generated_at` stays the same.
4. The dashboard checks the feed URL at the interval you set (Data button, "Scheduled feed") while the page is open. When `generated_at` changes it loads the new data, stores a copy in the browser and shows "Live feed" in the header.

"Real time" therefore means "as fresh as the agreed timetable". Hourly is realistic with this design; REDCap Data Entry Triggers can start a run after each save if the server team enables them (see section 5).

## 2. Run it

Node 18 or later, no packages to install.

```bash
# from a REDCap project (API token with export rights on the ADHMAT form)
REDCAP_URL=https://redcap.example.org/api/ REDCAP_TOKEN=xxxx \
  node pipeline/redcap_to_feed.mjs --out feed/adhmat-feed.json

# from a file you exported by hand (no API needed), useful for testing
node pipeline/redcap_to_feed.mjs --input export.csv --out feed/adhmat-feed.json
```

Options: `REDCAP_FORM` (default `adhmat_national_level`), `REDCAP_FILTER` (a REDCap filter logic such as `[approval_status]='1'` to publish approved records only), `--strict` (fail on any warning).

Exit code 1 means the data could not be imported (for example the wrong form was exported). Warnings (for example "overall score computed here differs from the REDCap calculated score") are printed and do not stop the run.

## 3. What the REDCap export must contain

Flat records, **raw** values (not labels), one record per Member State, from the **ADHMAT National Level** form (`adhmat_national_level`, Module 1 and Module 2 together). The list of fields the script requests is built in `A.requiredFields()` (`app/adhmat-core.js`). The importer recognises countries by the REDCap code (1 = Algeria …), by name, or by ISO3. Other points:

- Answers: `q_*` fields, 1 = Yes, 0 = No, 2 = N/A. Blank = not answered.
- Priority documents: `up_*` file fields. A Yes with a file counts as "document uploaded".
- Status: `review_m1_status` and `review_m2_status` when present, otherwise worked out from the answers.
- Module 2: the `sodh_` fields listed in `reference/field_map.json`; the dashboard shows Module 2 only for records whose status is Complete.
- If two records exist for one country the later row is used and a warning is shown.

## 4. Where to host the feed

- **Not in the public website repository.** GitHub Pages is public, so a feed file there is public. Real country results need Africa CDC approval for that, and some Member States chose "Africa CDC and Member State only" in the consent field.
- Host `adhmat-feed.json` on an Africa CDC web or storage service that sends `Access-Control-Allow-Origin` for the dashboard's address, then paste its URL in the Data panel (or set `feedUrl` in `app/adhmat-config.js` so every visitor gets it). A visitor can also open the dashboard with `?feed=https://…/adhmat-feed.json&every=15`.
- `adhmat-feed.workflow.yml` is a template for a GitHub Actions schedule. Use it only in a private repository.

## 5. Optional: update after each save (Data Entry Trigger)

In REDCap, Project Setup → Additional customisations → Data Entry Trigger, point to a small endpoint that starts the job (for example a GitHub `workflow_dispatch` call). The scheduled run stays as a safety net.

## 6. Testing without real data

The Data panel can download a **test file in REDCap export format** and a **test feed**, both generated from the built-in test data. Import the file, or serve the feed, to check the whole chain. `tests/` contains the automated checks (round trip, mock REDCap API, browser tests).

## 7. Things to confirm with the ADHMAT team

- The scoring method (independent, as built in REDCap V2.5 and used here, or gated as in the V2.4 deck).
- The timetable (hourly, nightly, weekly) and who owns the token.
- Where the feed is hosted and who may see real results (consent field).
- Module 2 `barrier_response` uses the response to Barrier 1 only; `phc_area` takes the first area ticked.
