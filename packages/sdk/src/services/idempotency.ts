import { createHash } from "node:crypto";

/**
 * Sentinel substituted for `parentAgentId` when the value is `null`.
 * Avoids ambiguity around hashing the literal string "null" or empty
 * string, both of which could collide with caller-supplied values.
 * @public
 */
export const IDEMPOTENCY_ROOT_SENTINEL = "__ROOT__";
/** @public */
export interface IdempotencyInput {
	readonly agentType: string;
	readonly parentAgentId: string | null;
	readonly clientNonce: string;
}

/**
 * Derive the canonical idempotency key for an `agents` row.
 *
 * Algorithm:
 *   sha256(agentType + "|" + (parentAgentId ?? "__ROOT__") + "|" + clientNonce)
 *   then base32 (RFC 4648 alphabet, lowercased) truncated to 26 chars.
 *
 * 26 base32 chars = 130 bits, far beyond the birthday-bound for the
 * scoping (UNIQUE per session). The base32 alphabet is a-z2-7 — all
 * lowercase to keep the column lexicographically friendly and
 * case-insensitive on filesystems that we never hit but might in
 * future debugging.
 * @public
 */
export const deriveIdempotencyKey = (input: IdempotencyInput): string => {
	const parent = input.parentAgentId ?? IDEMPOTENCY_ROOT_SENTINEL;
	const message = `${input.agentType}|${parent}|${input.clientNonce}`;
	const digest = createHash("sha256").update(message).digest();
	return base32Encode(digest).slice(0, 26);
};

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * RFC 4648 base32 encoder, lowercase, no padding. Produces ceil(8n/5)
 * characters from an `n`-byte input. SHA-256 output (32 bytes) yields
 * 52 base32 chars; the caller truncates to 26.
 */
const base32Encode = (bytes: Uint8Array): string => {
	let output = "";
	let buffer = 0;
	let bitsInBuffer = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bitsInBuffer += 8;
		while (bitsInBuffer >= 5) {
			bitsInBuffer -= 5;
			const index = (buffer >> bitsInBuffer) & 0x1f;
			output += BASE32_ALPHABET[index];
		}
	}
	if (bitsInBuffer > 0) {
		const index = (buffer << (5 - bitsInBuffer)) & 0x1f;
		output += BASE32_ALPHABET[index];
	}
	return output;
};
