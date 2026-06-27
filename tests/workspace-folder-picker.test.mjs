import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildFolderPickerScript, selectWorkspaceFolder } from "../apps/local-daemon/dist/apps/local-daemon/src/workspace-folder-picker.js";

test("folder picker script uses Windows Forms folder dialog", () => {
  const script = buildFolderPickerScript("C:\\workspace");
  assert.match(script, /System\.Windows\.Forms/);
  assert.match(script, /FolderBrowserDialog/);
  assert.match(script, /Write-Output \$dialog\.SelectedPath/);
});

test("selectWorkspaceFolder accepts injected picker result", async () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-picker-"));
  const selected = join(root, "project");
  mkdirSync(selected, { recursive: true });
  try {
    const result = await selectWorkspaceFolder(
      { mcpConfig: { allowedRoots: [root] } },
      {
        runPowerShell: async () => ({ exitCode: 0, stdout: selected + "\n", stderr: "" }),
      },
    );
    assert.deepStrictEqual(result, {
      selected: true,
      path: resolve(selected),
      message: "Workspace folder selected.",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selectWorkspaceFolder reports user cancellation", async () => {
  const result = await selectWorkspaceFolder(
    { mcpConfig: { allowedRoots: [] } },
    {
      runPowerShell: async () => ({ exitCode: 2, stdout: "", stderr: "" }),
    },
  );
  assert.deepStrictEqual(result, {
    selected: false,
    message: "User cancelled folder selection.",
  });
});
