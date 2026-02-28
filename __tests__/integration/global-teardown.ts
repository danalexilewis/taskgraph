import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GOLDEN_TEMPLATE_PATH_FILE = path.join(
  os.tmpdir(),
  "tg-golden-template-path.txt",
);

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(GOLDEN_TEMPLATE_PATH_FILE)) return;
  const templatePath = fs
    .readFileSync(GOLDEN_TEMPLATE_PATH_FILE, "utf8")
    .trim();
  if (templatePath && fs.existsSync(templatePath)) {
    fs.rmSync(templatePath, { recursive: true, force: true });
  }
  fs.unlinkSync(GOLDEN_TEMPLATE_PATH_FILE);
}
