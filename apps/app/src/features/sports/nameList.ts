/**
 * A list of things, as a sentence fragment a person would say.
 *
 * Its own module for the reason day.ts and placeName.ts are: a component
 * file that also exports a helper cannot be hot-swapped on its own, and
 * this is a thing with a RIGHT ANSWER rather than a look, so it is worth
 * testing and a test cannot reach into a component file.
 *
 * THREE THEN A COUNT. The empty state's note is one line and it names what
 * you follow; someone following eleven leagues would otherwise get four
 * lines of commas where the point of the sentence is "not these". Four is
 * where "and 2 more" starts being shorter than the names it replaces.
 */
export function nameList(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  if (labels.length === 3) return `${labels[0]}, ${labels[1]} and ${labels[2]}`;
  return `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`;
}
