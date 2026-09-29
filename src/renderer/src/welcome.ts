import type { RecentProject } from "../../shared/ipc";
import { detectLocale, resolveLocale, type Locale } from "./i18n/locale";
import { welcomeText } from "./i18n/welcomeMessages";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

const listEl = document.getElementById("list")!;

/**
 * The welcome window is a separate, vue-i18n-free entry: its few strings come
 * from `welcomeMessages` and are applied to `[data-i18n]` elements.
 */
let activeLocale: Locale = detectLocale();

function applyLocale(loc: Locale): void {
  activeLocale = loc;
  document.documentElement.lang = loc;
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n;
    if (key) el.textContent = welcomeText(key, loc);
  }
}

function openPath(p: string): void {
  window.api.welcomeAction({ type: "recent", path: p });
}

function render(items: RecentProject[]): void {
  listEl.innerHTML = "";
  if (!items.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = welcomeText("empty", activeLocale);
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

const DEFAULT_APP_NAME = "Beat Data Generator";

applyLocale(activeLocale);

void window.api.getRecents().then(render);

void window.api.getSettings().then((s) => {
  applyLocale(resolveLocale(s.locale));
  const name = (s.appName || "").trim() || DEFAULT_APP_NAME;
  const el = document.querySelector<HTMLElement>(".brand .name");
  if (el) el.textContent = name;
  document.title = name;
});
