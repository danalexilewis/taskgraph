"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const escape_1 = require("../../src/db/escape");
(0, vitest_1.describe)("sqlEscape", () => {
    (0, vitest_1.it)("should escape single quotes", () => {
        (0, vitest_1.expect)((0, escape_1.sqlEscape)("Don't do this")).toBe("Don''t do this");
    });
    (0, vitest_1.it)("should return the same string if no single quotes", () => {
        (0, vitest_1.expect)((0, escape_1.sqlEscape)("Hello World")).toBe("Hello World");
    });
    (0, vitest_1.it)("should handle empty string", () => {
        (0, vitest_1.expect)((0, escape_1.sqlEscape)("")).toBe("");
    });
    (0, vitest_1.it)("should handle string with only single quotes", () => {
        (0, vitest_1.expect)((0, escape_1.sqlEscape)("'''")).toBe("''''''");
    });
    (0, vitest_1.it)("should escape backslashes", () => {
        (0, vitest_1.expect)((0, escape_1.sqlEscape)("C:\\Users\\Test")).toBe("C:\\\\Users\\\\Test");
    });
    (0, vitest_1.it)("should remove null bytes", () => {
        (0, vitest_1.expect)((0, escape_1.sqlEscape)("null\0byte")).toBe("nullbyte");
    });
    (0, vitest_1.it)("should handle all special characters together", () => {
        (0, vitest_1.expect)((0, escape_1.sqlEscape)("It\'s a \\test with \0null byte")).toBe("It''s a \\\\test with null byte");
    });
});
