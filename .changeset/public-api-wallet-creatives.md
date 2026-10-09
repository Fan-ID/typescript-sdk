---
'soundlink': minor
---

Add `wallet.get`, `campaigns.updateAutoRenew`, and `metrics.creatives`. Create and campaign detail include `autoRenew`. Campaign list and detail include artist, track, and `campaignUrl`. Soundlink create and detail include `youtubeMusicUrl`.

`CampaignStatus` now matches the Public API: `creating`, `active`, `inactive`, `ended`, `renewing`, `restarting`, `restart_failed`, `renew_awaiting_charge`, `renew_failed`, `stopped`. `paused`, `completed`, and `failed` are removed.
