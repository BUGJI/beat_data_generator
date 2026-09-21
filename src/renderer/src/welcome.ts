import type { RecentProject } from "../../shared/ipc";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

const listEl = document.getElementById("list")!;

function openPath(p: string): void {
  window.api.welcomeAction({ type: "recent", path: p });
}

function render(items: RecentProject[]): void {
  listEl.innerHTML = "";
  if (!items.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "还没有打开过的工程，去新建或打开一个吧。";
    listEl.appendChild(div);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "item";
    const fn = document.createElement("div");
    fn.className = "fn";
    fn.textContent = item.title || basename(item.path);
    const fp = document.createElement("div");
    fp.className = "fp";
    fp.textContent = item.path;
    row.appendChild(fn);
    row.appendChild(fp);
    row.addEventListener("click", () => openPath(item.path));
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

const DEFAULT_APP_NAME = "Beat Data Generator";
void window.api.getSettings().then((s) => {
  const name = (s.appName || "").trim() || DEFAULT_APP_NAME;
  const el = document.querySelector<HTMLElement>(".brand .name");
  if (el) el.textContent = name;
  document.title = name;
});
