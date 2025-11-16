/**
 * Zigzag encode a number using arithmetic operations.
 * This supports the full safe integer range (up to Number.MAX_SAFE_INTEGER).
 * Formula: n < 0 ? -2*n - 1 : 2*n
 *
 * Used for encoding IDs in vector tiles to convert negative IDs to positive numbers
 * for unsigned varint encoding.
 */
export function zigzag(num: number): number {
	return num < 0 ? -2 * num - 1 : 2 * num
}

/**
 * Zigzag encode using bitwise operations (for geometry deltas only).
 * This is faster but limited to 32-bit signed integers.
 * Used for small coordinate deltas in geometry encoding.
 */
export function zigzag32(num: number): number {
	return (num << 1) ^ (num >> 31)
}

/**
 * Decode zigzag-encoded number back to original value.
 * Zigzag encoding is used to convert negative IDs to positive numbers for unsigned varint
 * encoding in vector tiles. Uses arithmetic-based decoding to support the full safe integer range.
 *
 * Formula: (encoded & 1) === 1 ? -(encoded + 1) / 2 : encoded / 2
 */
export function decodeZigzag(encoded: number): number {
	// Check if encoded is odd (negative) using bitwise, then use arithmetic
	return (encoded & 1) === 1 ? -(encoded + 1) / 2 : encoded / 2
}
