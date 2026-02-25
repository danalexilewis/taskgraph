import { describe, it, expect } from "vitest";
import { sqlEscape } from "../../src/db/escape";

describe("sqlEscape", () => {
  it("should escape single quotes", () => {
    expect(sqlEscape("Don't do this")).toBe("Don''t do this");
  });

  it("should return the same string if no single quotes", () => {
    expect(sqlEscape("Hello World")).toBe("Hello World");
  });

  it("should handle empty string", () => {
    expect(sqlEscape("")).toBe("");
  });

  it("should handle string with only single quotes", () => {
    expect(sqlEscape("'''")).toBe("''''''");
  });

  it("should escape backslashes", () => {
    expect(sqlEscape("C:\\Users\\Test")).toBe("C:\\\\Users\\\\Test");
  });

  it("should remove null bytes", () => {
    expect(sqlEscape("null\0byte")).toBe("nullbyte");
  });

  it("should handle all special characters together", () => {
    expect(sqlEscape("It\'s a \\test with \0null byte")).toBe(
      "It''s a \\\\test with null byte",
    );
  });
});
