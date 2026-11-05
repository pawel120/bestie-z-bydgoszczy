// The desktop engine creates `new Anthropic({ apiKey })`; in a browser the SDK refuses that without this flag.
import Base from "@anthropic-ai/sdk";

export * from "@anthropic-ai/sdk";
export default class Anthropic extends Base {
  constructor(options: ConstructorParameters<typeof Base>[0] = {}) {
    super({ ...options, dangerouslyAllowBrowser: true });
  }
}
