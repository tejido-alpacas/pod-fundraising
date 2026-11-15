import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { privateEvidencePng, testEvidencePng } from './image.ts';

const fingerprint = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('the two test pictures', () => {
	it('are PNG files, the same bytes every time', () => {
		for (const make of [testEvidencePng, () => privateEvidencePng('e2e-contractor')]) {
			expect(make().subarray(1, 4).toString('ascii')).toBe('PNG');
			expect(fingerprint(make())).toBe(fingerprint(make()));
		}
	});

	// Who may see a file is kept by its fingerprint. If the two were ever the same bytes, keeping
	// one from donors would hide the other.
	it('are never the same file', () => {
		for (const owner of ['e2e-contractor', 'pty_0b6f3c1e', '']) {
			expect(fingerprint(privateEvidencePng(owner))).not.toBe(fingerprint(testEvidencePng()));
		}
	});

	// Who may open a file kept from donors is recorded for its first uploader only.
	it('gives each uploader a picture of their own to keep from donors', () => {
		expect(fingerprint(privateEvidencePng('pty_a'))).not.toBe(
			fingerprint(privateEvidencePng('pty_b'))
		);
	});

	it('keeps the public picture’s bytes as they have always been', () => {
		expect(fingerprint(testEvidencePng())).toBe(
			'50ed8bee412c989534ea8bc30c3324c55b3a77fd48f4b9e70b8840d5ee8d6428'
		);
	});
});
