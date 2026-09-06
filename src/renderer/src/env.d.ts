/// <reference types="vite/client" />
import type { IpcApi } from "@shared/ipc";

declare global {
  interface Window {
    api: IpcApi;
  }

  interface ProcessVersions {
    node: string;
    chrome: string;
    electron: string;
  }

  const process: { versions: ProcessVersions };
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

export {};
