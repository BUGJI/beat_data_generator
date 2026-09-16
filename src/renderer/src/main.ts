import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { i18n } from "./i18n";
import "./styles/tailwind.css";
import "./styles/index.css";
import { initEditorRuntime } from "./services/bootstrap";

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
initEditorRuntime();
app.mount("#app");
