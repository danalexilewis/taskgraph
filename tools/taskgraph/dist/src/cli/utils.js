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
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
const TASKGRAPH_DIR = ".taskgraph";
const CONFIG_FILE = path.join(TASKGRAPH_DIR, "config.json");
function readConfig(basePath) {
    const configPath = path.join(basePath ?? process.cwd(), CONFIG_FILE);
    if (!(0, fs_1.existsSync)(configPath)) {
        return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.CONFIG_NOT_FOUND, `Config file not found at ${configPath}. Please run 'tg init' first.`));
    }
    try {
        const configContents = (0, fs_1.readFileSync)(configPath, "utf-8");
        return (0, neverthrow_1.ok)(JSON.parse(configContents));
    }
    catch (e) {
        return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.CONFIG_PARSE_FAILED, `Failed to parse config file at ${configPath}`, e));
    }
}
function writeConfig(config, basePath) {
    const configPath = path.join(basePath ?? process.cwd(), CONFIG_FILE);
    try {
        (0, fs_1.writeFileSync)(configPath, JSON.stringify(config, null, 2));
        return (0, neverthrow_1.ok)(undefined);
    }
    catch (e) {
        return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.CONFIG_PARSE_FAILED, `Failed to write config file to ${configPath}`, e));
    }
}
