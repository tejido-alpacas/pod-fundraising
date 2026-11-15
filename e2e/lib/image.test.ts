import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { privateEvidencePng, testEvidencePng } from './image.ts';

const fingerprint = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('the two test pictures', () => {
	it('are PNG files, the same bytes every time', () => {
		for (const make of [testEvidencePng, privateEvidencePng]) {
			expect(make().subarray(1, 4).toString('ascii')).toBe('PNG');
			expect(fingerprint(make())).toBe(fingerprint(make()));
		}
	});

	// Who may see a file is kept by its fingerprint. If the two were ever the same bytes, keeping
	// one from donors would hide the other.
	it('are never the same file', () => {
		expect(fingerprint(privateEvidencePng())).not.toBe(fingerprint(testEvidencePng()));
	});

	it('keeps the public picture’s bytes as they have always been', () => {
		expect(fingerprint(testEvidencePng())).toBe(
			'50ed8bee412c989534ea8bc30c3324c55b3a77fd48f4b9e70b8840d5ee8d6428'
		);
	});
});
