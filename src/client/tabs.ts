export function initTabs(root: ParentNode = document): void {
  // ── App-detail top-level tabs ─────────────────────────────────────────────
  // Outer:   <div data-app-detail-tabs="store">
  // Buttons: <button role="tab" data-tab-id="...">
  // Panels:  <div role="tabpanel" data-tab-id="...">
  root.querySelectorAll<HTMLElement>("[data-app-detail-tabs]").forEach((group) => {
    const buttons = Array.from(
      group.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id]'),
    );
    const panels = Array.from(
      group.querySelectorAll<HTMLElement>('[role="tabpanel"][data-tab-id]'),
    );

    buttons.forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.tabId!;

        buttons.forEach((x) => {
          const sel = x.dataset.tabId === id;
          x.setAttribute("aria-selected", sel ? "true" : "false");
          x.classList.toggle("is-active", sel);
        });

        panels.forEach((p) => {
          p.hidden = p.dataset.tabId !== id;
        });

        group.dataset.appDetailTabs = id;

        // Sync URL hash so TD tab is deep-linkable; remove hash on store tab.
        if (id !== "store") {
          history.replaceState(null, "", `${location.pathname}#${id}`);
        } else {
          history.replaceState(null, "", location.pathname);
        }
      }),
    );
  });

  // Respect URL hash on load (deep-link to TD tab or any named tab).
  const hash = location.hash.replace(/^#/, "");
  if (hash) {
    document
      .querySelectorAll<HTMLButtonElement>(`button[role="tab"][data-tab-id="${hash}"]`)
      .forEach((b) => b.click());
  }

  // ── Breakdown sub-tabs (inside TdBreakdownPanel) ──────────────────────────
  // Outer:   <div data-td-breakdown>
  // Buttons: <button data-breakdown-tab="...">
  // Panels:  <div data-breakdown-panel="...">
  root.querySelectorAll<HTMLElement>("[data-td-breakdown]").forEach((group) => {
    const buttons = Array.from(
      group.querySelectorAll<HTMLButtonElement>("button[data-breakdown-tab]"),
    );
    const panels = Array.from(
      group.querySelectorAll<HTMLElement>("[data-breakdown-panel]"),
    );

    buttons.forEach((b) =>
      b.addEventListener("click", () => {
        const dim = b.dataset.breakdownTab!;

        buttons.forEach((x) => {
          const sel = x.dataset.breakdownTab === dim;
          x.setAttribute("aria-selected", sel ? "true" : "false");
          x.classList.toggle("is-active", sel);
        });

        panels.forEach((p) => {
          p.hidden = p.dataset.breakdownPanel !== dim;
        });
      }),
    );
  });
}
