/** Where the suite keeps what it writes. Both folders are ignored by git. */
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

/** Screenshots and the HTML report. This folder, and only this one, is uploaded by the workflow. */
export const ARTIFACTS = join(root, 'artifacts');
export const SCREENSHOTS = join(ARTIFACTS, 'screenshots');
export const REPORT = join(ARTIFACTS, 'report');

/**
 * The signed-in browser state of each test person: their session cookie. Kept OUTSIDE the
 * artifacts folder on purpose, so it is never uploaded, and never printed.
 */
const AUTH = join(root, '.auth');
export const CONTRACTOR_STATE = join(AUTH, 'contractor.json');
export const CONFIRMER_STATE = join(AUTH, 'confirmer.json');
/** The visitor signed in on the Campaign Site: a different cookie, for a different host. */
export const DONOR_STATE = join(AUTH, 'donor.json');
/** Playwright's own scratch output (failure screenshots before they reach the report). */
export const TEST_OUTPUT = join(root, '.test-output');
