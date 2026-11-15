/**
 * The two small pictures the suite uploads as evidence: real PNGs, made here so no binary file
 * is committed. Each is the same bytes every run, so the evidence store keeps a single copy of
 * each. They differ on purpose: who may see a file is kept by its fingerprint, so the picture
 * that is kept from donors must never be the same bytes as the public one.
 */
import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const check = Buffer.alloc(4);
	check.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, check]);
}

type Colour = [number, number, number];

/** A 96 by 96 picture of diagonal bands in two colours, about 300 bytes. */
function bands(dark: Colour, light: Colour): Buffer {
	const size = 96;
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header.writeUInt8(8, 8); // bits per channel
	header.writeUInt8(2, 9); // colour type: RGB

	const rows: Buffer[] = [];
	for (let y = 0; y < size; y++) {
		const row = Buffer.alloc(1 + size * 3); // the first byte is the row's filter: none
		for (let x = 0; x < size; x++) {
			const band = Math.floor((x + y) / 12) % 2 === 0;
			row.set(band ? dark : light, 1 + x * 3);
		}
		rows.push(row);
	}

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(Buffer.concat(rows))),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** The public picture: green and cream bands. Its bytes must never change (see above). */
export function testEvidencePng(): Buffer {
	return bands([0x1f, 0x6f, 0x5c], [0xf2, 0xe9, 0xd8]);
}

/** The picture kept from donors: grey bands. Different bytes from the public one, always. */
export function privateEvidencePng(): Buffer {
	return bands([0x55, 0x55, 0x5a], [0xdd, 0xdd, 0xe2]);
}

/** What `setInputFiles` takes. */
export function testEvidenceFile(): { name: string; mimeType: string; buffer: Buffer } {
	return { name: 'e2e-evidence.png', mimeType: 'image/png', buffer: testEvidencePng() };
}

/** The same, for the picture that is kept from donors. */
export function privateEvidenceFile(): { name: string; mimeType: string; buffer: Buffer } {
	return { name: 'e2e-kept-from-donors.png', mimeType: 'image/png', buffer: privateEvidencePng() };
}
