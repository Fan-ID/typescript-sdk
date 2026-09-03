---
'soundlink': minor
---

Align self-serve soundlink metrics with the campaign-parity Public API. ([SOU-6696](https://linear.app/getsoundlink/issue/SOU-6696))

- Add `soundlinks.breakdown.list` / `.export` / `.export.collect` (`soundlink_country_daily`)
- Add `soundlinks.engagement.list` / `.export` / `.export.collect` (`soundlink_engagement_daily`)
- Remove `soundlinks.metricsTimeseries` and the top-tracks `soundlinks.engagement()` helper
- Fix `SoundlinkMetricsOverview` types (no new/returning splits on overview)
