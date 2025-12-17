/**
 * Copied from https://github.com/delventhalz/browser-hash.
 * MIT License: https://raw.githubusercontent.com/delventhalz/browser-hash/refs/heads/main/LICENSE
 *
 * Modifications:
 * - Added TypeScript types.
 */

import type { TypedArray } from "@osmix/core/src/typed-arrays"

/**
 * Determine if a value is a valid ArrayBuffer or TypedArray.
 *
 * @param {*} val - the value to check
 * @returns {boolean}
 */
export function isBuffer(val: ArrayBuffer | TypedArray) {
	const buffer =
		val != null && typeof val === "object" && "buffer" in val ? val.buffer : val

	return (
		Boolean(buffer) &&
		buffer.constructor === ArrayBuffer &&
		!(val instanceof DataView)
	)
}

/**
 * Convert a string into a UTF-8 encoded Uint8Array.
 *
 * @param {string} str - the string to convert
 * @returns {Uint8Array}
 */
export function stringToBuffer(str: string) {
	if (typeof str !== "string") {
		throw new TypeError(`Attempted to convert string, got: ${typeof str}`)
	}

	return new TextEncoder().encode(str)
}

/**
 * Convert an ArrayBuffer or TypedArray into a hexadecimal string.
 *
 * @param {ArrayBuffer} buffer - the buffer to convert
 * @returns {string} - a hex string
 */
export function bufferToHex(buffer: ArrayBuffer | TypedArray) {
	if (!isBuffer(buffer)) {
		throw new TypeError(`Attempted to convert buffer, got: ${typeof buffer}`)
	}

	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
}

function convertAndHash(
	strOrBuffer: string | ArrayBuffer,
	algo: AlgorithmIdentifier,
) {
	const buffer =
		typeof strOrBuffer === "string" ? stringToBuffer(strOrBuffer) : strOrBuffer

	return window.crypto.subtle.digest(algo, buffer)
}

/**
 * Asynchronously hash a string or array buffer using native functionality,
 * returning the digest formatted as a Uint8Array.
 *
 * @param {string | ArrayBuffer} strOrBuffer - the value to hash
 * @param {string} [algo] - a valid algorithm name string
 * @returns {Promise<Uint8Array>} - the digest formatted as a Uint8Array
 */
export async function bufferHash(
	strOrBuffer: string | ArrayBuffer,
	algo = "SHA-256",
) {
	const digest = await convertAndHash(strOrBuffer, algo)
	return new Uint8Array(digest)
}

/**
 * Asynchronously hash a string or array buffer using native functionality,
 * returning the digest formatted as a hexadecimal string.
 *
 * @param {string | ArrayBuffer} strOrBuffer - the value to hash
 * @param {string} [algo] - a valid algorithm name string
 * @returns {Promise<string>} - the digest formatted as a hexadecimal string
 */
export default async function browserHash(
	strOrBuffer: string | ArrayBuffer,
	algo = "SHA-256",
) {
	const digest = await convertAndHash(strOrBuffer, algo)
	return bufferToHex(digest)
}
