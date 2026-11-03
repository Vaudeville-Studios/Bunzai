/** Git identifies the repository-local overrides that test subprocesses must never inherit. */
export function testGitEnvironment(): NodeJS.ProcessEnv {
  const result = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("test isolation: Git could not identify repository-local variables; check that Git is installed before retrying");
  const env = { ...process.env };
  for (const name of [...result.stdout.toString().trim().split(/\s+/), ...Object.keys(env).filter((key) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key))]) delete env[name];
  return env;
}
