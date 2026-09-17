---
'soundlink': minor
---

Add `soundlinks.create` (`POST /v1/soundlinks`) and `soundlinks.delete` (`DELETE /v1/soundlinks/{id}`). Create requires `soundlinks:write` and `idempotencyKey`. Delete archives the soundlink (`status: archived`) and does not send `Idempotency-Key`.
