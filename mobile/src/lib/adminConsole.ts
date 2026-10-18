import * as WebBrowser from "expo-web-browser";

/** The web console, for the pages the phone admin opens there (Insights, Blog posts, Audit Log, …). */
export const CONSOLE_URL = "https://admin.notefusion.studio";

/**
 * Opens a web console page in the in-app browser. It asks for its own sign-in there (and its passkey), so nothing of
 * the phone's session is handed over.
 */
export function openConsole(path: string): void {
  void WebBrowser.openBrowserAsync(`${CONSOLE_URL}${path.startsWith("/") ? path : `/${path}`}`).catch(() => undefined);
}
