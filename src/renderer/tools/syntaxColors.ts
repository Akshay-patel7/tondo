// Syntax colors that replace theme colors under WCAG AA's 4.5:1 for normal
// text. Each replacement keeps its color's OKLCH hue and is the nearest shade
// that reaches 4.6:1, a margin over 4.5, on every background the theme draws
// that color on. syntaxColors.test.ts checks them. Keys are lowercase, as
// Shiki looks colors up.

/**
 * For pierre-light, the diffs' light theme. Code sits on --sidebar (code.tsx),
 * so a diff line's backgrounds are that surface, the added and removed lines'
 * 11% tints of --addition and --deletion, and the changed words' 8% more of
 * each on those tints.
 */
export const DIFF_LIGHT: Readonly<Record<string, string>> = {
  "#737373": "#5c5c5c", // comments
  "#636363": "#5c5c5c", // punctuation, parameters
  "#199f43": "#006b28", // strings
  "#1ca1c7": "#03647e", // numbers
  "#d5a910": "#725905", // constants
  "#d5901c": "#805300", // namespaces, constant variables
  "#d32a61": "#b7074e", // keywords
  "#d47628": "#904904", // variables
  "#a631be": "#981eb0", // types, classes
  "#08c0ef": "#08647e", // operators
  "#1a85d4": "#025f9e", // decorators
  "#d5512f": "#ac2e06", // language variables
  "#18a46c": "#086a44", // attribute names
  "#17a5af": "#07666d", // regular expressions
  "#16a994": "#05685b", // escapes
};

/** For pierre-dark, against the dark surface, tints and 20% word highlights. */
export const DIFF_DARK: Readonly<Record<string, string>> = {
  "#737373": "#b0b0b0", // comments
  "#636363": "#b0b0b0", // punctuation, operators
  "#a3a3a3": "#b0b0b0", // parameters
  "#ff678d": "#ff8ea5", // keywords
  "#9d6afb": "#bca1fe", // functions
  "#d568ea": "#eb8bfe", // types, classes
  "#69b1ff": "#6eb4ff", // decorators
  "#ff855e": "#ff9370", // language variables
};

/**
 * For github-light, which highlights code blocks in replies, on the page's
 * --background. The orange also draws changed lines in diff markup, on
 * github-light's #ffebda.
 */
export const CODE_BLOCK_LIGHT: Readonly<Record<string, string>> = {
  "#d73a49": "#d33546", // keywords
  "#22863a": "#1e8337", // tags
  "#e36209": "#b24c06", // variables
};

/** For github-dark, on the dark --background. */
export const CODE_BLOCK_DARK: Readonly<Record<string, string>> = {
  "#6a737d": "#7b848e", // comments
};
