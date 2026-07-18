import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortlessArgs,
  detectDetachedWorktreePrefix,
  sanitizeHostnameLabel,
} from "./portless-dev.ts";

function gitRunner(values: Record<string, string | undefined>) {
  return (args: readonly string[]) => values[args.join(" ")];
}

void test("leaves main and branch worktrees to Portless native prefixing", () => {
  assert.equal(
    detectDetachedWorktreePrefix(gitRunner({ "rev-parse --abbrev-ref HEAD": "feature/portless" })),
    undefined,
  );
  assert.deepEqual(createPortlessArgs("merge.osmix", ["vite"], null), [
    "run",
    "--name",
    "merge.osmix",
    "vite",
  ]);
});

void test("uses the Git administration ID for detached linked worktrees", () => {
  const prefix = detectDetachedWorktreePrefix(
    gitRunner({
      "rev-parse --abbrev-ref HEAD": "HEAD",
      "rev-parse --git-dir": "/repo/.git/worktrees/osmix2",
      "rev-parse --git-common-dir": "/repo/.git",
    }),
  );
  assert.equal(prefix, "osmix2");
  assert.deepEqual(createPortlessArgs("merge.osmix", ["vite"], prefix), [
    "run",
    "--name",
    "osmix2.merge.osmix",
    "vite",
  ]);
});

void test("ignores detached primary checkouts, malformed metadata, and non-Git directories", () => {
  assert.equal(
    detectDetachedWorktreePrefix(
      gitRunner({
        "rev-parse --abbrev-ref HEAD": "HEAD",
        "rev-parse --git-dir": "/repo/.git",
        "rev-parse --git-common-dir": "/repo/.git",
      }),
    ),
    undefined,
  );
  assert.equal(
    detectDetachedWorktreePrefix(
      gitRunner({
        "rev-parse --abbrev-ref HEAD": "HEAD",
        "rev-parse --git-dir": "/tmp/not-a-worktree",
        "rev-parse --git-common-dir": "/repo/.git",
      }),
    ),
    undefined,
  );
  assert.equal(detectDetachedWorktreePrefix(gitRunner({})), undefined);
});

void test("sanitizes detached worktree IDs for DNS labels", () => {
  assert.equal(sanitizeHostnameLabel("Feature_UI@2"), "feature-ui-2");
  assert.equal(sanitizeHostnameLabel("---"), undefined);
});

void test("requires an underlying development command", () => {
  assert.throws(() => createPortlessArgs("merge.osmix", [], null), {
    message: "Expected an underlying development command",
  });
});
