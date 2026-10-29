---
name: New-app data isolation
description: Which Supabase project belongs to this grant app, and which must never be touched.
---

Treat this product as a new app, separate from the user's existing GrantFlow Hub. An account-authorized Supabase connector does not establish that its project is intended as this app's data store.

**Dedicated project (confirmed by the user 2026-10-28):** `futurenestfund`, ref `fybslfcepjnswcnoewgi`, EU (eu-central-1 pooler). This is the only Supabase project this app may use. Ref `ukeikuaduqmbkkhmzewg` appeared once in pasted connection details and is not this app's; never connect to it.

**Why:** The user explicitly requested a new app after an existing grant product had been located. Reusing its data target could mix real records with a new preview.

**How to apply:** Only connect to `fybslfcepjnswcnoewgi`. Never migrate or write to the existing grant app as a shortcut. Keep credentials in env vars / Replit Secrets, never in git.
