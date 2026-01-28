declare module "clawdbot/plugin-sdk" {
  export interface ClawdbotPluginApi {
    pluginConfig: Record<string, unknown> | undefined;
    logger: {
      info(msg: string): void;
      warn(msg: string): void;
      error(msg: string): void;
      debug(msg: string): void;
    };
    runtime: {
      config: {
        loadConfig(): Promise<Record<string, unknown>>;
        writeConfigFile(cfg: Record<string, unknown>): Promise<void>;
      };
    };
    registerTool(factory: (ctx: ClawdbotPluginToolContext) => unknown[], opts?: { names?: string[] }): void;
    on(event: string, handler: (...args: unknown[]) => unknown | Promise<unknown>, opts?: { priority?: number }): void;
  }

  export interface ClawdbotPluginToolContext {
    sessionId?: string;
    [key: string]: unknown;
  }
}
