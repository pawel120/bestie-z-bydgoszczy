// Keys and options come in the URL fragment (#c=…), built by `npm run bot`. The fragment never leaves the browser in
// HTTP requests, so the static host never sees the keys (Recall does: it stores the bot's page URL).

export interface PageConfig {
  elevenlabs?: string;
  groq?: string;
  anthropic?: string;
  openrouter?: string;
  /** Transcription language ("pl", "en" or "auto"). */
  lang?: string;
  /** Opened by the Recall bot: listen to the meeting and start recording on its own. */
  bot?: boolean;
  /** Camera follows the conversation on its own (always on in the bot). */
  handsfree?: boolean;
}

export function readConfig(): PageConfig {
  const raw = new URLSearchParams(location.hash.slice(1)).get("c");
  if (!raw) return {};
  try {
    const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0))));
  } catch {
    return {};
  }
}
