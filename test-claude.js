const { spawn } = require("child_process");

const child = spawn("claude", [
  "--print",
  "--verbose",
  "--output-format",
  "stream-json",
  "--input-format",
  "stream-json",
], {
  cwd: require("os").homedir() + "/.atelier",
  stdio: ["pipe", "pipe", "pipe"],
});

child.stdout.on("data", (data) => console.log(`STDOUT: ${data.toString()}`));
child.stderr.on("data", (data) => console.log(`STDERR: ${data.toString()}`));

child.on("close", (code) => {
  console.log(`Child exited with code ${code}`);
});

const msg = JSON.stringify({
  type: "user",
  message: { role: "user", content: "hello" }
});

child.stdin.write(msg + "\n");
// WE DO NOT CALL child.stdin.end() to simulate Rust's ActiveSession behavior.
