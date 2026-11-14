# FilePicker

Camera-first entry point for evidence.

- **Take a photo** is primary and opens the camera (`capture="environment"`). **Choose files** takes photos and PDFs. On containers 700px and wider, a drop zone appears.
- State the limits underneath, from the contracts: JPG, PNG, WEBP or PDF, up to 10 MB each, up to 6 files per entry.
- Picking a file starts the upload at once and adds a row to `UploadProgress`. The picker never waits for a submit button.
