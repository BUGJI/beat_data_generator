import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { i18n } from "./i18n";
import "./styles/tailwind.css";
import "./styles/index.css";
import { initEditorRuntime } from "./services/bootstrap";

// Surface uncaught renderer errors in the console so they reach the main-process
// log (see logger.ts) instead of vanishing with a reload/crash.
window.addEventListener("error", (e) => {
  console.error("[renderer] uncaught error", e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[renderer] unhandled rejection", e.reason);
});

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
initEditorRuntime();
app.mount("#app");
