export function initSortableTables(): void {
  document.querySelectorAll<HTMLTableElement>(".rankings-table").forEach((table) => {
    const headers = table.querySelectorAll<HTMLTableCellElement>("thead th[data-sort]");
    headers.forEach((h: HTMLTableCellElement, idx: number) => {
      h.style.cursor = "pointer";
      h.addEventListener("click", () => sortBy(table, idx, h.dataset.sort!));
    });
  });
}

function sortBy(table: HTMLTableElement, colIndex: number, key: string) {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const dir = table.dataset.sortDir === "asc" && table.dataset.sortKey === key ? "desc" : "asc";
  table.dataset.sortDir = dir;
  table.dataset.sortKey = key;

  const rows = Array.from(tbody.rows);
  rows.sort((a, b) => {
    const av = cellValue(a.cells[colIndex]!);
    const bv = cellValue(b.cells[colIndex]!);
    const cmp = compare(av, bv);
    return dir === "asc" ? cmp : -cmp;
  });
  for (const r of rows) tbody.appendChild(r);
}

function cellValue(td: HTMLTableCellElement): string | number {
  const num = parseFloat(td.textContent?.replace(/[^\d.\-]/g, "") ?? "");
  if (!Number.isNaN(num) && /\d/.test(td.textContent ?? "")) return num;
  return (td.textContent ?? "").trim().toLowerCase();
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
