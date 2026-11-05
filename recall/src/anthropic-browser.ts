// The desktop engine creates `new Anthropic({ apiKey })`; in a browser the SDK refuses that without this flag.
import Base from "@anthropic-ai/sdk";
import { readConfig } from "./config";

export * from "@anthropic-ai/sdk";
export default class Anthropic extends Base {
  constructor(options: ConstructorParameters<typeof Base>[0] = {}) {
    // With your login, web/local.mjs serves this page and answers as the API on the same address.
    super({ ...options, dangerouslyAllowBrowser: true, ...(readConfig().login ? { baseURL: location.origin } : {}) });
  }
}
