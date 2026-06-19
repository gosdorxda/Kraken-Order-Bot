declare module "kraken-api" {
  interface KrakenOptions {
    url?: string;
    version?: number;
    timeout?: number;
  }

  class KrakenClient {
    constructor(key: string, secret: string, options?: KrakenOptions);
    api(method: string, params?: Record<string, unknown>): Promise<{ result: any; error?: string[] }>;
  }

  export = KrakenClient;
}
