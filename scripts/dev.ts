const children = [
  Bun.spawn(["bun", "run", "dev:api"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }),
  Bun.spawn(["bun", "run", "dev:web"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }),
];

function stop() {
  for (const child of children) {
    child.kill();
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(143);
});

await Promise.race(children.map((child) => child.exited));
stop();

