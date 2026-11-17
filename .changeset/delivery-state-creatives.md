---
'soundlink': minor
---

Add `delivery_state` on creative metrics children (`disapproved` | `null`). Expose `metrics.creativesBatch`, and teach the local API emulator `GET/POST` creatives metrics plus a `disapprove_creatives` harness transition for integrator tests. Release only after the Public API returns `delivery_state` on creatives children — older responses omit the field and break null checks.
