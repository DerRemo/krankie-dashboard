export interface NavApp { appStoreId: string; name: string | null }

export interface LayoutProps {
  title: string;
  active: "overview" | "system" | "td" | null;
  /** App Store id of the app whose nav link is active, if any. */
  activeApp?: string;
  navApps: NavApp[];
  /** Whether TelemetryDeck is configured (TELEMETRYDECK_API_TOKEN set). Hides the nav link otherwise — an always-empty nav destination reads as unfinished. */
  tdConfigured: boolean;
  children: unknown;
}

export function Layout({ title, active, activeApp, navApps, tdConfigured, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{title} — krankie</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/style.css" />
        <script type="module" src="/client.js" defer></script>
      </head>
      <body>
        <header class="glass site-header">
          <nav class="site-nav">
            <a class="site-brand" href="/">
              <span class="logo-mark"><span class="logo-mark-dot"></span></span>
              krankie
            </a>
            <a href="/" aria-current={active === "overview" ? "page" : undefined}>Overview</a>
            {navApps.map((a) => (
              <a href={`/apps/${a.appStoreId}`} aria-current={activeApp === a.appStoreId ? "page" : undefined}>
                {a.name ?? a.appStoreId}
              </a>
            ))}
            {tdConfigured && (
              <a href="/td" aria-current={active === "td" ? "page" : undefined}>TelemetryDeck</a>
            )}
            <a href="/system" aria-current={active === "system" ? "page" : undefined}>System</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
