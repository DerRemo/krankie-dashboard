/** The top-of-page title row (title + optional right-aligned actions), shared
 * across all top-level views so every page has one instead of some pages
 * having no header at all. Detail/drill-down pages (app-detail, keyword
 * history, store compare) use their own larger "hero" header — this is only
 * for the flat list-style pages. */
export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: unknown }) {
  return (
    <header class="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p class="page-head-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div class="page-actions">{actions}</div> : null}
    </header>
  );
}
