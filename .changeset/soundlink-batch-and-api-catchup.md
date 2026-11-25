---
'soundlink': minor
---

Add Public API catch-up: `soundlinks.breakdown.exportBatch`, `soundlinks.retentionExportBatch`, `retentionWeekly` (campaign + soundlink), `campaigns.activityBatch`, `metrics.overviewBatch`, `wallet.transactions`, and `soundlinks.sendTestEvent`. Sync OpenAPI with backend (batch export paths). Introduce `HttpClient.postJsonl` with a 120s default for batch exports.
