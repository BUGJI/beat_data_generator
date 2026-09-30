import type {
  MarketInstallResult,
  MarketPluginView,
} from "../../shared/market";
import { handle } from "../ipcHandle";
import { pingEndpoint } from "../network";
import { installLocalZip, installPlugin, uninstallPlugin } from "./installer";
import { listMarket } from "./inventory";
import { setMarketSettings, type MarketNetworkSettings } from "./registry";

/**
 * Main-process plugin marketplace, split into:
 *   registry.ts  - registry index fetch + cache + network/proxy
 *   inventory.ts - local install state, semver helpers, renderer view
 *   installer.ts - download/verify/extract/swap install and uninstall
 *
 * Network access lives here (the renderer has no Node privileges). Downloads
 * are strictly HTTPS and every artifact must carry a SHA-256 in the index.
 */
export function installMarketManager(opts?: {
  getSettings?: () => MarketNetworkSettings;
}): void {
  if (opts?.getSettings) setMarketSettings(opts.getSettings);

  handle("marketList", (): Promise<MarketPluginView[]> => listMarket(false));

  handle("marketRefresh", (): Promise<MarketPluginView[]> => listMarket(true));

  handle(
    "marketInstall",
    (_e, id: string, version?: string): Promise<MarketInstallResult> =>
      installPlugin(id, version),
  );

  handle("marketUninstall", (_e, id: string): boolean => uninstallPlugin(id));

  handle(
    "installPluginZip",
    (): Promise<MarketInstallResult | null> => installLocalZip(),
  );

  handle("pingHost", (_e, url: string) => pingEndpoint(url));
}
