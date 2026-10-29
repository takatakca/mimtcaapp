import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const mockDir = mkdtempSync(join(tmpdir(), "mimt-uptime-"));
afterAll(() => rmSync(mockDir, { recursive: true, force: true }));

const curl = [
  "#!/usr/bin/env bash",
  'url="$(printf \'%s\\n\' "$@" | tail -n 1)"',
  'case "$url" in',
  '  *"/ads.txt"*) echo "google.com, pub-4518068873401341, DIRECT, f08c47fec0942fa0" ;;',
  '  *"/healthz"*) echo \'{"ok":true}\' ;;',
  '  *"/readyz"*)',
  '    if [[ "$MOCK_SCHEMA_OUTDATED" == "1" ]]; then echo \'{"ok":true,"db":"up","schema":"outdated"}\';',
  '    elif [[ "$MOCK_DOWN_API" == "1" ]]; then exit 22;',
  '    else echo \'{"ok":true,"db":"up","schema":"current"}\'; fi ;;',
  '  *) echo "MIMT" ;;',
  'esac',
].join("\n");

const gh = [
  "#!/usr/bin/env bash",
  'case "$1 $2" in',
  '  "label create") exit 0 ;;',
  '  "issue list")',
  '    if [[ "$MOCK_GH_LIST_FAIL" == "1" ]]; then exit 42; fi',
  '    if [[ "$MOCK_EXISTING_INCIDENT" == "1" ]]; then',
  '      echo \'[{"title":"Panne: api.mimt.ca","number":42}]\';',
  '    else echo "[]"; fi ;;',
  '  "issue create") if [[ "$MOCK_GH_CREATE_FAIL" == "1" ]]; then exit 43; fi ;;',
  '  "issue comment") if [[ "$MOCK_GH_COMMENT_FAIL" == "1" ]]; then exit 44; fi ;;',
  '  "issue close") if [[ "$MOCK_GH_CLOSE_FAIL" == "1" ]]; then exit 45; fi ;;',
  '  *) exit 99 ;;',
  'esac',
].join("\n");

for (const [name, content] of [["curl", curl], ["gh", gh]] as const) {
  writeFileSync(join(mockDir, name), content);
  chmodSync(join(mockDir, name), 0o700);
}

function monitor(env: Record<string, string> = {}) {
  return spawnSync("bash", ["scripts/monitor/uptime.sh"], {
    cwd: projectRoot,
    env: { ...process.env, PATH: mockDir + ":" + process.env.PATH, ATTEMPTS: "1", PAUSE: "0", ...env },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("uptime monitoring with hermetic curl / GitHub fakes", () => {
  it("accepts healthy API and current schema", () => {
    const result = monitor({ DRY_RUN: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("UP    api.mimt.ca");
    expect(result.stdout).toContain("services down: 0");
  });
  it("treats outdated schema as degraded API", () => {
    const result = monitor({ DRY_RUN: "1", MOCK_SCHEMA_OUTDATED: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DOWN  api.mimt.ca");
    expect(result.stdout).toContain("services down: 1");
  });
  it("keeps successful outage notification green", () => {
    const result = monitor({ MOCK_DOWN_API: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("issue opened");
    expect(result.stdout).toContain("services down: 1");
  });
  it("fails if existing issue lookup fails", () => {
    const result = monitor({ MOCK_GH_LIST_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unable to inspect existing incident issues");
  });
  it("fails if incident creation fails", () => {
    const result = monitor({ MOCK_DOWN_API: "1", MOCK_GH_CREATE_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unable to open outage issue");
  });
  it("does not close recovery after a comment error", () => {
    const result = monitor({ MOCK_EXISTING_INCIDENT: "1", MOCK_GH_COMMENT_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unable to comment on recovery issue");
    expect(result.stdout).not.toContain("closed (recovered)");
  });
  it("fails if an incident cannot be closed", () => {
    const result = monitor({ MOCK_EXISTING_INCIDENT: "1", MOCK_GH_CLOSE_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unable to close recovery issue");
  });
});
