// Fractional indexing using base-62 strings for card ordering within columns.
// Keys are lexicographically comparable strings that can always have new keys
// inserted between any two existing keys.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length; // 62

function digitIndex(c: string): number {
  return DIGITS.indexOf(c);
}

function digitChar(i: number): string {
  return DIGITS[i]!;
}

/**
 * Find a key lexicographically between `a` and `b`.
 *
 * Algorithm: walk digit-by-digit. When the digits differ by more than 1,
 * pick the midpoint and return. When they are adjacent (differ by exactly 1),
 * take the lower digit and continue into the next position with an open
 * upper bound (0..BASE-1). When they are equal, carry that digit forward
 * and continue.
 */
function midkey(a: string, b: string, bOpen: boolean): string {
  const n = Math.max(a.length, b.length) + 1; // +1 ensures we can always extend
  let result = "";

  for (let i = 0; i < n; i++) {
    const aDigit = i < a.length ? digitIndex(a[i]!) : 0;
    const bDigit = bOpen || i >= b.length ? BASE - 1 : digitIndex(b[i]!);

    if (aDigit === bDigit) {
      result += digitChar(aDigit);
      continue;
    }

    const mid = aDigit + Math.floor((bDigit - aDigit) / 2);
    if (mid > aDigit) {
      return result + digitChar(mid);
    }

    // bDigit === aDigit + 1 (adjacent). Take aDigit and open the upper bound
    // for subsequent positions.
    result += digitChar(aDigit);
    bOpen = true;
  }

  // Safety fallback (shouldn't be reached with the +1 padding)
  return result + digitChar(Math.floor(BASE / 2));
}

export function generateKeyBetween(params: {
  a: string | null;
  b: string | null;
}): string {
  const { a, b } = params;

  if (a !== null && b !== null && a >= b) {
    throw new Error(
      `generateKeyBetween: a must be less than b, got a="${a}", b="${b}"`
    );
  }

  if (a === null && b === null) {
    return midkey("", "", true);
  }

  if (a === null) {
    return midkey("", b!, false);
  }

  if (b === null) {
    return midkey(a, "", true);
  }

  return midkey(a, b, false);
}
