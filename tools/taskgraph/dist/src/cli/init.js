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
exports.initCommand = initCommand;
const fs_1 = require("fs");
const execa_1 = require("execa");
const migrate_1 = require("../db/migrate");
const path = __importStar(require("path"));
const utils_1 = require("./utils");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
const TASKGRAPH_DIR = ".taskgraph";
const CONFIG_FILE = path.join(TASKGRAPH_DIR, "config.json");
function initCommand(program) {
    program
        .command("init")
        .description("Initializes the Dolt repository and applies migrations")
        .option("--no-commit", "Do not commit changes to Dolt", false)
        .action(async (options, cmd) => {
        const repoPath = process.cwd();
        const taskGraphPath = path.join(repoPath, TASKGRAPH_DIR);
        const doltRepoPath = path.join(taskGraphPath, "dolt");
        const initResult = await neverthrow_1.ResultAsync.fromPromise((async () => {
            if (!(0, fs_1.existsSync)(taskGraphPath)) {
                (0, fs_1.mkdirSync)(taskGraphPath);
            }
            if (!(0, fs_1.existsSync)(doltRepoPath)) {
                // Create the doltRepoPath directory before initializing Dolt
                (0, fs_1.mkdirSync)(doltRepoPath, { recursive: true });
                console.log(`Creating Dolt repository at ${doltRepoPath}...`);
                await (0, execa_1.execa)("dolt", ["init"], { cwd: doltRepoPath }); // Changed cwd to doltRepoPath
                console.log("Dolt repository created.");
            }
            else {
                console.log(`Dolt repository already exists at ${doltRepoPath}.`);
            }
            return Promise.resolve(); // Explicitly return a Promise<void>
        })(), // Invoked the async IIFE
        (e) => (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to initialize Dolt repository", e))
            .andThen(() => (0, migrate_1.applyMigrations)(doltRepoPath, options.noCommit))
            .andThen(() => {
            const config = {
                doltRepoPath: doltRepoPath,
            };
            // Use a valid ErrorCode, e.g., UNKNOWN_ERROR
            return (0, utils_1.writeConfig)(config, repoPath).mapErr((e) => // Pass repoPath as basePath
             (0, errors_1.buildError)(errors_1.ErrorCode.UNKNOWN_ERROR, "Failed to write config", e));
        });
        initResult.match(() => {
            if (!cmd.parent?.opts().json) {
                console.log(`Configuration written to ${CONFIG_FILE}`);
                console.log("Task Graph initialized successfully.");
            }
            // ... rest of the match block remains the same
        }, (error) => {
            const appError = error;
            console.error(`Error initializing Task Graph: ${appError.message}`); // Used appError.message
            if (cmd.parent?.opts().json) {
                console.log(JSON.stringify({
                    status: "error",
                    code: appError.code,
                    message: appError.message,
                    cause: appError.cause,
                }));
            }
            process.exit(1);
        });
    });
}
