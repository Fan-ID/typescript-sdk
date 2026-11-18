---
'soundlink': minor
---

Add `delivery_reason` on creative metrics children: the Meta policy name when `delivery_state` is `disapproved`, otherwise `null`. The local API emulator's `disapprove_creatives` transition accepts an optional `reason` to set it.
