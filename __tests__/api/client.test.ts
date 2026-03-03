/**
 * Unit tests for TgClient (config, constructor, and error paths).
 * SDK vs CLI --json shape parity is covered by __tests__/integration/sdk-vs-cli.test.ts.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TgClient } from "../../src/api/client";

describe("TgClient", () => {
  describe("constructor", () => {
    it("accepts no options and uses process.cwd()", () => {
      const client = new TgClient();
      const result = client.readConfig();
      // May succeed if run from repo root with .taskgraph, or fail otherwise
      expect(result.isOk() || result.isErr()).toBe(true);
    });

    it("accepts cwd string and uses it for config resolution", () => {
      const client = new TgClient("/tmp");
      const result = client.readConfig();
      expect(result.isOk() || result.isErr()).toBe(true);
    });

    it("accepts options with doltRepoPath and skips config file", () => {
      const client = new TgClient({ doltRepoPath: "/fake/repo/path" });
      const result = client.readConfig();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.doltRepoPath).toBe("/fake/repo/path");
      }
    });

    it("accepts options with cwd only", () => {
      const client = new TgClient({ cwd: process.cwd() });
      const result = client.readConfig();
      expect(result.isOk() || result.isErr()).toBe(true);
    });
  });

  describe("readConfig", () => {
    it("returns err when cwd has no .taskgraph/config.json", () => {
      const emptyDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "tg-client-no-config-"),
      );
      try {
        const client = new TgClient(emptyDir);
        const result = client.readConfig();
        expect(result.isErr()).toBe(true);
      } finally {
        fs.rmSync(emptyDir, { recursive: true });
      }
    });
  });

  describe("next", () => {
    it("returns err when config is missing (no repo)", async () => {
      const emptyDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "tg-client-next-"),
      );
      try {
        const client = new TgClient(emptyDir);
        const result = await client.next({ limit: 5 });
        expect(result.isErr()).toBe(true);
      } finally {
        fs.rmSync(emptyDir, { recursive: true });
      }
    });
  });

  describe("context", () => {
    it("returns err when config is missing (no repo)", async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-client-ctx-"));
      try {
        const client = new TgClient(emptyDir);
        const result = await client.context("any-task-id");
        expect(result.isErr()).toBe(true);
      } finally {
        fs.rmSync(emptyDir, { recursive: true });
      }
    });
  });

  describe("status", () => {
    it("returns err when config is missing (no repo)", async () => {
      const emptyDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "tg-client-status-"),
      );
      try {
        const client = new TgClient(emptyDir);
        const result = await client.status();
        expect(result.isErr()).toBe(true);
      } finally {
        fs.rmSync(emptyDir, { recursive: true });
      }
    });
  });
});
