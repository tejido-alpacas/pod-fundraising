# UploadProgress

One row per chosen file, showing exactly where it is.

- **States:** `is-uploading` (bar and "2.1 of 3.4 MB"), `is-done` ("Uploaded · fingerprint 2afbe48b…"), `is-queued` ("Saved on this phone · will send when online", dashed), `is-failed` (amber, with the reason and **Retry**, or **Remove** when retrying can't help, such as a wrong type or a file too large), and `is-excluded` (twill thumbnail, "Left out: taken before this project began").
- Meta lines are `aria-live="polite"`. Failures are `role="alert"`.
- Never show "Uploaded" before `POST /api/evidence` returns a URL and SHA-256.
