/** Start the normal Bun suite without inherited hook repository authority; forward arguments, signals, and exit status. */
import { testGitEnvironment } from "./test-git-env";

const child = Bun.spawn([process.execPath, "test", ...process.argv.slice(2)], {
  env: testGitEnvironment(), stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
const interrupt = () => child.kill("SIGINT");
const terminate = () => child.kill("SIGTERM");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
const code = await child.exited;
process.off("SIGINT", interrupt);
process.off("SIGTERM", terminate);
process.exit(code);
