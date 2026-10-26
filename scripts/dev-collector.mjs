import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const collectorDir = join(root, "apps", "collector");
const wranglerCli = join(collectorDir, "node_modules", "wrangler", "bin", "wrangler.js");
if (!existsSync(join(collectorDir, ".dev.vars"))) {
  console.error("먼저 프로젝트 루트에서 npm run setup:local 을 실행해 주세요.");
  process.exit(1);
}
const environment = {
  ...process.env,
  XDG_CONFIG_HOME: join(collectorDir, ".config"),
  WRANGLER_LOG_PATH: join(collectorDir, ".wrangler-logs"),
};
const migration = spawnSync(process.execPath, [wranglerCli, "d1", "migrations", "apply", "recruitment-monitor", "--local"], {
  cwd: collectorDir, env: environment, stdio: "inherit",
});
if (migration.error || migration.status !== 0) {
  console.error("로컬 D1 마이그레이션에 실패했습니다.");
  process.exit(migration.status ?? 1);
}
const server = spawn(process.execPath, [wranglerCli, "dev", "--local", "--port", "8787"], {
  cwd: collectorDir, env: environment, stdio: "inherit",
});
server.on("error", (error) => { console.error(error); process.exitCode = 1; });
server.on("exit", (code) => { process.exitCode = code ?? 0; });
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
