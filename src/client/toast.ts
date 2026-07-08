export function showToast(text: string, kind: "info" | "success" | "error" = "info"): void {
  const root = ensureRoot();
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.classList.add("toast-leaving"), 3000);
  setTimeout(() => el.remove(), 3500);
}

function ensureRoot(): HTMLElement {
  let r = document.getElementById("toast-root");
  if (!r) {
    r = document.createElement("div");
    r.id = "toast-root";
    document.body.appendChild(r);
  }
  return r;
}
