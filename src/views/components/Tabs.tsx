export interface TabItem { label: string; href: string }

export function Tabs({ items, active }: { items: TabItem[]; active: number }) {
  return (
    <nav class="tabs" role="tablist">
      {items.map((it, i) => (
        <a class="tab" href={it.href} role="tab" aria-current={i === active ? "page" : undefined}>
          {it.label}
        </a>
      ))}
    </nav>
  );
}
