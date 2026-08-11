import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillRoot = join(repoRoot, "skills", "use-mimo-bridge-mcp");

test("bundled Codex skill documents the current P0 contract", async () => {
  const skill = await readFile(join(skillRoot, "SKILL.md"), "utf-8");
  const playbook = await readFile(join(skillRoot, "references", "playbook.md"), "utf-8");
  const metadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf-8");
  const combined = skill + "\n" + playbook;

  assert.match(skill, /^---\nname: use-mimo-bridge-mcp\n/);
  assert.match(skill, /references\/playbook\.md/);
  for (const topic of [
    "MiMo Bridge Client.cmd",
    "idempotency_key",
    "preparing_worktree",
    "starting_agent",
    "request_id",
    "error_detail",
    "reload_required",
    "allowedRoots",
    "max_rounds",
    "DAEMON_RESTARTED",
  ]) {
    assert.ok(combined.includes(topic), `missing skill topic: ${topic}`);
  }
  assert.doesNotMatch(combined, /<stable-key>/);
  assert.match(metadata, /default_prompt:.*\$use-mimo-bridge-mcp/);
});

test("portable and installer validation require the bundled Codex skill", async () => {
  const portable = await readFile(join(repoRoot, "scripts", "build-portable.ps1"), "utf-8");
  const installer = await readFile(join(repoRoot, "scripts", "installer", "install.ps1"), "utf-8");
  const validation = await readFile(join(repoRoot, "scripts", "validate-release.ps1"), "utf-8");

  for (const content of [portable, installer, validation]) {
    assert.match(content, /codex-skill[\\/]use-mimo-bridge-mcp[\\/]SKILL\.md/);
    assert.match(content, /Install MiMo Bridge Codex Skill\.cmd/);
  }
  assert.match(portable, /includes_codex_skill = \$true/);
  assert.match(installer, /Move-ChildIfExists[^\n]+-Name "codex-skill"/);
  assert.match(installer, /Remove-KnownChild[^\n]+-Name "codex-skill"/);
});

test("Codex skill installer backs up an existing skill before replacement", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "mimo-codex-skill-test-"));
  const destinationRoot = join(root, "skills");
  const installer = join(repoRoot, "scripts", "install-codex-skill.ps1");
  const run = () => spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", installer,
    "-DestinationRoot", destinationRoot,
  ], { cwd: repoRoot, encoding: "utf-8" });

  try {
    const first = run();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const installedSkill = join(destinationRoot, "use-mimo-bridge-mcp", "SKILL.md");
    await writeFile(installedSkill, (await readFile(installedSkill, "utf-8")) + "\nLOCAL_MARKER\n", "utf-8");

    const second = run();
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.doesNotMatch(await readFile(installedSkill, "utf-8"), /LOCAL_MARKER/);

    const backups = await readdir(join(destinationRoot, ".mimo-bridge-skill-backups"));
    assert.equal(backups.length, 1);
    assert.match(await readFile(join(destinationRoot, ".mimo-bridge-skill-backups", backups[0], "SKILL.md"), "utf-8"), /LOCAL_MARKER/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
