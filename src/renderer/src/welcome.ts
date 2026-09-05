function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

const listEl = document.getElementById("list")!;

function openPath(p: string): void {
  window.api.welcomeAction({ type: "recent", path: p });
}

function render(items: string[]): void {
  listEl.innerHTML = "";
  if (!items.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "本会话还没有打开过的工程。";
    listEl.appendChild(div);
    return;
  }
  for (const p of items) {
    const row = document.createElement("div");
    row.className = "item";
    const fn = document.createElement("div");
    fn.className = "fn";
    fn.textContent = basename(p);
    const fp = document.createElement("div");
    fp.className = "fp";
    fp.textContent = p;
    row.appendChild(fn);
    row.appendChild(fp);
    row.addEventListener("click", () => openPath(p));
    listEl.appendChild(row);
  }
}

document.getElementById("btn-new")!.addEventListener("click", () => {
  window.api.welcomeAction({ type: "new" });
});
document.getElementById("btn-open")!.addEventListener("click", () => {
  window.api.welcomeAction({ type: "open" });
});

void window.api.getRecents().then(render);
