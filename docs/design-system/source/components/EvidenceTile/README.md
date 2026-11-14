# EvidenceTile

One piece of evidence in any of its seven states.

- **States:** photo, document, uploading (dimmed with a progress bar and percentage), failed (amber, **Retry**), waiting to sync (dashed, "Saved on this phone"), left out (twill texture, dashed edge) and not public (plain tile).
- **Provide:** `kind`, `caption`, `fingerprint` where one exists, and a `reason` for left out, not public and failed. The reason goes in the caption, not on the image.
- Left out and not public are deliberate. They must never look like a broken image or an error.
