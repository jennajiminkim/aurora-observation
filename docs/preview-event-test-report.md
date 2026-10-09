# Aurora Terminal v2.6 — browser integration smoke test

The following checks used Playwright with **in-memory mocked NOAA JSON and localStorage**, not a live NOAA response. No synthetic results were submitted as real evidence.

- 4 pt initial reading: one KST daily record, zero captured events
- Preview 85 pt: STORM rendering; real daily reading stayed 4pt; no event created
- Real-path mocked NOAA 65 pt: one 45-row frozen colored ASCII snapshot archived
- Later 70 pt: no duplicate event while already above threshold
- Later 58, 56 pt from two distinct forecast timestamps: capture becomes re-armed
- Later 84 pt: new second archive event
- During open preview, genuine-path mock 90 pt: did not save preview value or erroneously duplicate capture
- All five Card 3 failures: timeout, auth (401/403), rate limit (429), offline, schema change
- Card 3 synthetic recovery D2: freshness fresh; archive events unchanged
- HTML and PNG frame downloads: successful in browser simulation
- ASCII stage at browser widths 1648px, 1100px, 600px: left/right stage margins balanced; no clipping
- JavaScript runtime errors in simulation: none

Important: real deployment still needs manual verification with actual NOAA API, persistent browser storage, public GitHub Pages URL, and two separate real Asia/Seoul dates for Card 5.
