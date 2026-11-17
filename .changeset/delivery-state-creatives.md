---
'soundlink': minor
---

Add optional `delivery_state` on creative metrics children (`disapproved` | `null`, omitted on older APIs). Expose `metrics.creativesBatch`, and teach the local API emulator `GET/POST` creatives metrics plus a `disapprove_creatives` harness transition for integrator tests. Prefer `== null` until every environment returns the field.
