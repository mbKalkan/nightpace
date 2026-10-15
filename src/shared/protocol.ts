// Messages between the extension host and the timeline webview.

/** User-facing text for the webview, translated by the host. */
export interface PanelStrings {
  title: string;
  empty: string;
  privacy: string;
}

export type HostToWebviewMessage = { type: 'init'; locale: string; strings: PanelStrings };

export type WebviewToHostMessage = { type: 'ready' };
