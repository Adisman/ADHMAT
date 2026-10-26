# Test data (generated, not real)

These files are generated test data in the formats the dashboard accepts. They are for checking the import and the pipeline. They are not real country results.

- `ADHMAT_TEST_REDCap_export.csv`: all 55 Member States, REDCap flat export format (raw values).
- `ADHMAT_TEST_partial_export_12_countries.csv`: 12 records, one part-answered, one empty, and one whose REDCap score is deliberately inconsistent, to see how warnings and "not started" countries look.
- `ADHMAT_TEST_feed.json`: the same data as a dashboard feed (`adhmat-feed/1`).

Import them with the Data button on the continental dashboard, or run `node pipeline/redcap_to_feed.mjs --input app/test-data/ADHMAT_TEST_REDCap_export.csv`.
