export function Card({ children, class: cls }: { children: unknown; class?: string }) {
  return <div class={`card ${cls ?? ""}`.trim()}>{children}</div>;
}
