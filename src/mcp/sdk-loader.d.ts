/**
 * Type declarations for SDK loader. Runtime loads from SDK dist/cjs to avoid
 * package export resolution issues with subpaths.
 */
declare module "./sdk-loader.js" {
  import type { Readable, Writable } from "node:stream";

  export class McpServer {
    constructor(
      serverInfo: { name: string; version: string },
      options?: { capabilities?: { tools?: object } },
    );
    connect(transport: TransportLike): Promise<void>;
  }

  export interface TransportLike {
    start(): Promise<void>;
    send(message: unknown, options?: unknown): Promise<void>;
    close(): Promise<void>;
    onmessage?: (message: unknown) => void;
    onclose?: () => void;
    onerror?: (error: Error) => void;
  }

  export class StdioServerTransport implements TransportLike {
    constructor(stdin?: Readable, stdout?: Writable);
  }
}
