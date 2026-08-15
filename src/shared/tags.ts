/**
 * `#hashtag` extraction. Pure and dependency-free so it can be unit-tested and run in
 * either process — the main process derives a note's tags from its text on every save.
 */

/**
 * A tag is a `#` that starts a word, followed by a letter and then letters/digits/`_`/`-`.
 *
 * Requiring a *letter* first keeps `#1` and `#2026` out. Requiring the `#` to start a word
 * keeps `code#1` out. The 50-character cap stops a malformed paste from turning a whole
 * paragraph into a tag.
 */
const TAG_RE = /(?:^|[\s([{])#([\p{L}][\p{L}\p{N}_-]{0,49})/gu

/** Unique, lower-cased tags in the order they first appear. */
export function extractTags(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(TAG_RE)) found.add(m[1].toLowerCase())
  return [...found]
}
