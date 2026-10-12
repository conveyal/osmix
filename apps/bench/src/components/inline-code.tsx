/** Render `backticked` spans in a description as code. */
export function InlineCode({ text }: { text: string }) {
  return text
    .split("`")
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>));
}
