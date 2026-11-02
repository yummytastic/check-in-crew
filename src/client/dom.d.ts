// The client is plain JavaScript checked with `checkJs`. Element lookups are
// left untyped so the existing `.value` / `.hidden` / `.checked` access does not
// need a cast at every call site; everything else is still type-checked.
// To tighten later: remove these overloads and add JSDoc casts where needed.
interface ParentNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  querySelector(selectors: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  querySelectorAll(selectors: string): NodeListOf<any>;
}
interface Element {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  closest(selectors: string): any;
}
