/**
 * The other small files the suite offers as evidence, besides the picture in `image.ts`: a
 * PDF it uploads, and two files the App must refuse. All are made here, so no binary file is
 * committed, and each is the same bytes every run, so the evidence store keeps one copy.
 */
import { createHash } from 'node:crypto';

export interface EvidenceFile {
	name: string;
	mimeType: string;
	buffer: Buffer;
}

/** A real one-page PDF showing one line of text, about 500 bytes. */
function tinyPdf(line: string): Buffer {
	if (!/^[A-Za-z0-9 .,:-]+$/.test(line)) {
		throw new Error('The line on a test PDF is plain letters, digits and spaces.');
	}
	const stream = `BT /F1 12 Tf 20 60 Td (${line}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 120] /Contents 4 0 R ' +
			'/Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let body = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((object, index) => {
		offsets.push(body.length);
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const table = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`;
	return Buffer.from(body, 'ascii');
}

/** A document any donor may open. */
export function testDocumentFile(): EvidenceFile {
	return {
		name: 'e2e-document.pdf',
		mimeType: 'application/pdf',
		buffer: tinyPdf('Tejido automated end-to-end check. A test document, not real evidence.')
	};
}

/**
 * The most the App takes for one file: `EVIDENCE_MAX_BYTES` in
 * `packages/contracts/src/evidence.ts`. Written here too because this suite does not import
 * the product's code; if the App's limit changes, the check that uses this fails and names it.
 */
export const EVIDENCE_MAX_MEGABYTES = 10;

/** One byte more than the App takes. The App refuses it in the browser: it is never sent. */
export function tooBigFile(): EvidenceFile {
	return {
		name: 'e2e-too-big.png',
		mimeType: 'image/png',
		buffer: Buffer.alloc(EVIDENCE_MAX_MEGABYTES * 1024 * 1024 + 1)
	};
}

/** A kind of file the App does not take as evidence: plain text. */
export function wrongKindFile(): EvidenceFile {
	return {
		name: 'e2e-notes.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('Tejido automated end-to-end check. Not a photo or a PDF.\n', 'ascii')
	};
}

/** The fingerprint the App names a stored file by: the SHA-256 of its bytes. */
export function fingerprintOf(file: EvidenceFile): string {
	return createHash('sha256').update(file.buffer).digest('hex');
}
