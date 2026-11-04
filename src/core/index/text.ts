/** Words as the index and the similar-pages query see them: lower case, no diacritics, letters and digits only. */

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** The words of a text, folded, in order. */
export const wordsOf = (s: string): string[] => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

// Words too common to say what a page is about, in the two languages the brains mix (§4.3).
const STOPWORDS = new Set(
  (
    "a an and are as at be been but by for from has have how in is it its of on or that the this to was were what when where which who why will with " +
    "al con como cual cuando de del donde el en es esta este esto la las lo los mas no o para por que se si sin sobre su sus un una uno unas unos y ya"
  ).split(" "),
);

/** The words that say what a text is about: not stopwords, at least three letters. */
export const significantWords = (s: string): string[] => [
  ...new Set(wordsOf(s).filter((w) => w.length >= 3 && !STOPWORDS.has(w))),
];

/**
 * The stem two forms of a word share: all but its last three letters, at least four letters kept, so `deploying` and
 * `deploy`, `migrations` and `migrate`, `migración` and `migraciones` meet.
 */
export const stemOf = (w: string): string => w.slice(0, Math.max(4, w.length - 3));

/** Whether a page's title holds every word of a query, each by its start: the strong text match of §4.3. */
export const titleHolds = (query: string): ((page: { title: string }) => boolean) => {
  const words = wordsOf(query);
  return (page) => {
    const title = wordsOf(page.title);
    return words.length > 0 && words.every((w) => title.some((t) => t.startsWith(w)));
  };
};
