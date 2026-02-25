"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupIntegrationTest = setupIntegrationTest;
exports.teardownIntegrationTest = teardownIntegrationTest;
exports.runTgCli = runTgCli;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const execa_1 = require("execa");
const migrate_1 = require("../../src/db/migrate");
const utils_1 = require("../../src/cli/utils");
async function setupIntegrationTest() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-integration-"));
    const doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");
    const cliPath = "./dist/cli/index.js";
    // Create .taskgraph/dolt directory
    fs.mkdirSync(doltRepoPath, { recursive: true });
    // Initialize Dolt repo
    await (0, execa_1.execa)("dolt", ["init"], { cwd: doltRepoPath }); // Reverted to "dolt"
    // Write config
    (0, utils_1.writeConfig)({ doltRepoPath: doltRepoPath }, tempDir).unwrapOrThrow(); // Corrected signature
    // Apply migrations
    (await (0, migrate_1.applyMigrations)(doltRepoPath)).unwrapOrThrow();
    return { tempDir, doltRepoPath, cliPath };
}
function teardownIntegrationTest(tempDir) {
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
// Helper to run CLI commands in the integration test context
async function runTgCli(command, cwd, expectError = false) {
    const TG_BIN = "pnpm run start --filter taskgraph -- ";
    try {
        const { stdout, stderr, exitCode } = await (0, execa_1.execa)(TG_BIN + command, {
            cwd,
            shell: true,
        });
        if (expectError && exitCode === 0) {
            throw new Error(`Expected command to fail but it succeeded. Output: ${stdout}, Error: ${stderr}`);
        }
        if (!expectError && exitCode !== 0) {
            throw new Error(`Command failed unexpectedly. Exit Code: ${exitCode}, Output: ${stdout}, Error: ${stderr}`);
        }
        return { stdout, stderr, exitCode };
    }
    catch (error) {
        if (expectError) {
            return {
                stdout: error.stdout || "",
                stderr: error.stderr || error.message,
                exitCode: error.exitCode ?? 1,
            };
        }
        throw error;
    }
}
