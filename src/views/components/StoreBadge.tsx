const FLAGS: Record<string, string> = {
  us: "🇺🇸", gb: "🇬🇧", de: "🇩🇪", fr: "🇫🇷", es: "🇪🇸", it: "🇮🇹",
  jp: "🇯🇵", cn: "🇨🇳", br: "🇧🇷", ca: "🇨🇦", au: "🇦🇺", nl: "🇳🇱", se: "🇸🇪",
};

export function StoreBadge({ store }: { store: string }) {
  const flag = FLAGS[store.toLowerCase()] ?? "🏳";
  return <span class="store-badge">{flag} <span class="store-code">{store.toUpperCase()}</span></span>;
}
