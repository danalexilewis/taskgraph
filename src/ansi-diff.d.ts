declare module "ansi-diff" {
  interface AnsiDiff {
    update(content: string): string;
    clear(): void;
    resize(opts: { width?: number; height?: number }): void;
  }
  function ansiDiff(opts?: { width?: number; height?: number }): AnsiDiff;
  export default ansiDiff;
}
