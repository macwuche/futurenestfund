---
name: New-app data isolation
description: Why the new grant app must not silently reuse the existing product's connected database.
---

Treat this product as a new app, separate from the user's existing GrantFlow Hub. An account-authorized Supabase connector does not establish that its project is intended as this app's data store.

**Why:** The user explicitly requested a new app after an existing grant product had been located. Reusing its data target could mix real records with a new preview.

**How to apply:** Keep sample records isolated. Confirm a dedicated Supabase target before provisioning real auth/data or modifying connected tables. Never migrate or write to the existing grant app as a shortcut.
