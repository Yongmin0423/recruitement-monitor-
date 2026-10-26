import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  console.error("터미널에서 npm run setup:local 을 실행해 주세요.");
  process.exit(1);
}
process.stdout.write("개인용 접속 비밀번호 (10자 이상): ");
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
let password = "";
process.stdin.on("data", (key) => {
  if (key === "\u0003") process.exit(130);
  if (key === "\r" || key === "\n") {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
    if (password.length < 10) {
      console.error("비밀번호는 10자 이상이어야 합니다.");
      process.exitCode = 1;
      return;
    }
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    password = "";
    const token = randomBytes(32).toString("base64url");
    const sessionSecret = randomBytes(48).toString("base64url");
    writeFileSync(join(root, "apps/web/.env.local"), [
      "PERSONAL_PASSWORD_HASH=scrypt\\$" + salt + "\\$" + hash,
      "SESSION_SECRET=" + sessionSecret,
      "COLLECTOR_URL=http://localhost:8787",
      "COLLECTOR_API_TOKEN=" + token,
      ""
    ].join("\n"), { mode: 0o600 });
    writeFileSync(join(root, "apps/collector/.dev.vars"), "APP_API_TOKEN=" + token + "\n", { mode: 0o600 });
    console.log("로컬 접속 설정을 만들었습니다.");
    return;
  }
  if (key === "\u007f" || key === "\b") {
    if (password.length) { password = password.slice(0, -1); process.stdout.write("\b \b"); }
    return;
  }
  password += key;
  process.stdout.write("*".repeat([...key].length));
});
