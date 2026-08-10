/**
 * Best-effort matching of a user text selection (taken from the PDF.js text
 * layer, whose extraction differs from the backend's mined text in spacing,
 * ligatures, and similar artifacts) onto a slide's mined text. The result is
 * always a literal substring of the mined text, so the backend's
 * selection-verification (normalized containment) accepts it by construction.
 */

interface SquashedText {
  squashed: string;
  /** Original index of each squashed character. */
  offsets: number[];
}

const ALNUM = /[\p{L}\p{N}]/u;

function squash(value: string): SquashedText {
  const lower = value.toLocaleLowerCase();
  const offsets: number[] = [];
  let squashed = "";
  for (let index = 0; index < lower.length; index += 1) {
    const character = lower[index]!;
    if (ALNUM.test(character)) {
      squashed += character;
      offsets.push(index);
    }
  }
  return { squashed, offsets };
}

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokenize(value: string): Token[] {
  const result: Token[] = [];
  for (const match of value.toLocaleLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    result.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return result;
}

/**
 * Returns the substring of `slideText` that best matches `selection`, or
 * undefined when less than half of the selection's words can be found.
 *
 * Two stages: an exact match ignoring everything but letters and digits
 * (covers extraction spacing/punctuation differences), then a fuzzy
 * word-window match (covers small wording corrections between revisions).
 */
export function matchSelectionToSlideText(
  selection: string,
  slideText: string
): string | undefined {
  const sel = squash(selection);
  const mined = squash(slideText);
  if (sel.squashed.length < 3 || mined.squashed.length === 0) return undefined;
  const index = mined.squashed.indexOf(sel.squashed);
  if (index >= 0) {
    const start = mined.offsets[index]!;
    const end = mined.offsets[index + sel.squashed.length - 1]! + 1;
    return slideText.slice(start, end);
  }
  return fuzzyWordMatch(selection, slideText);
}

function fuzzyWordMatch(selection: string, slideText: string): string | undefined {
  const selectionWords = tokenize(selection).map((token) => token.word);
  const minedTokens = tokenize(slideText);
  if (selectionWords.length === 0 || minedTokens.length === 0) return undefined;
  const windowLength = Math.min(
    minedTokens.length,
    selectionWords.length + Math.ceil(selectionWords.length / 4) + 2
  );
  let best: { score: number; start: number; end: number } | undefined;
  for (let offset = 0; offset < minedTokens.length; offset += 1) {
    const window = minedTokens.slice(offset, offset + windowLength);
    let score = 0;
    let cursor = 0;
    let firstMatch = -1;
    let lastMatch = -1;
    for (const word of selectionWords) {
      for (let position = cursor; position < window.length; position += 1) {
        if (window[position]!.word === word) {
          score += 1;
          if (firstMatch < 0) firstMatch = position;
          lastMatch = position;
          cursor = position + 1;
          break;
        }
      }
    }
    if (firstMatch >= 0 && (!best || score > best.score)) {
      best = {
        score,
        start: window[firstMatch]!.start,
        end: window[lastMatch]!.end
      };
    }
  }
  if (!best || best.score < Math.max(1, Math.ceil(selectionWords.length / 2))) return undefined;
  return slideText.slice(best.start, best.end);
}
