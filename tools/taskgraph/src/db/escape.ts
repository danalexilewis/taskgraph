export function sqlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\0/g, "");
}
