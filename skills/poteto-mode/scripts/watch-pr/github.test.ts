import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChecksUnavailable,
  GhGitHubReader,
  WatcherQueryError,
  mapRollupNode,
  orderStack,
  parsePullRequest,
  parseReviewThreads,
  resolveChecks,
  resolveContext,
} from "./github.ts";
import {
  fakeReader,
  failedCheck,
  passingCheck,
  pendingCheck,
} from "./fakes.test-helper.ts";
import { parsePrNumber } from "./types.ts";

const context = {
  owner: "owner",
  repo: "repo",
  number: parsePrNumber(42),
};

describe("checks fallback chain", () => {
  it("uses a non-empty fast-path result without a rollup query", async () => {
    const reader = fakeReader({
      fastPath: { kind: "checks", checks: [passingCheck("fast")] },
    });
    const read = await resolveChecks(reader, context);
    expect(read.source).toBe("gh-pr-checks");
    expect(read.checks.map((check) => check.name)).toEqual(["fast"]);
    expect(reader.calls).toEqual(["checksFastPath"]);
  });

  it("paginates GraphQL when the fast path is unusable", async () => {
    const reader = fakeReader({
      fastPath: { kind: "unusable", exitCode: 8, stderr: "" },
      rollupPages: [
        { checks: [passingCheck("first")], endCursor: "next" },
        { checks: [failedCheck("second")], endCursor: null },
      ],
    });
    const read = await resolveChecks(reader, context);
    expect(read.source).toBe("graphql-rollup");
    expect(read.checks.map((check) => check.name)).toEqual(["first", "second"]);
    expect(reader.calls).toEqual([
      "checksFastPath",
      "checkRollupPage:null",
      "checkRollupPage:next",
    ]);
  });

  it("falls back when valid fast-path JSON represented an empty list", async () => {
    const reader = fakeReader({
      fastPath: { kind: "checks", checks: [] },
      rollupPages: [{ checks: [pendingCheck("fallback")], endCursor: null }],
    });
    expect((await resolveChecks(reader, context)).checks[0].name).toBe(
      "fallback"
    );
    expect(reader.calls).toEqual(["checksFastPath", "checkRollupPage:null"]);
  });

  it("fails closed when both paths are empty", async () => {
    const reader = fakeReader({
      fastPath: {
        kind: "unusable",
        exitCode: 8,
        stderr: "credential cannot read checks",
      },
    });
    await expect(resolveChecks(reader, context)).rejects.toBeInstanceOf(
      ChecksUnavailable
    );
    expect(reader.calls).toEqual(["checksFastPath", "checkRollupPage:null"]);
  });
});

describe("rollup node mapping", () => {
  it("maps terminal and non-terminal CheckRun states fail closed", () => {
    const cases = [
      ["IN_PROGRESS", null, "pending", "PENDING"],
      ["COMPLETED", "SUCCESS", "passed", "SUCCESS"],
      ["COMPLETED", "NEUTRAL", "skipped", "NEUTRAL"],
      ["COMPLETED", "SKIPPED", "skipped", "SKIPPED"],
      ["COMPLETED", "ACTION_REQUIRED", "failed", "ACTION_REQUIRED"],
      ["COMPLETED", "TIMED_OUT", "failed", "FAILURE"],
      ["COMPLETED", "FUTURE_VALUE", "failed", "FAILURE"],
    ] as const;
    for (const [status, conclusion, kind, reportedState] of cases) {
      expect(
        mapRollupNode({
          __typename: "CheckRun",
          name: "ci",
          status,
          conclusion,
        })
      ).toMatchObject({ kind, reportedState });
    }
  });

  it("classifies an in-progress Code Review Gate from the rollup as the gate", () => {
    expect(
      mapRollupNode({
        __typename: "CheckRun",
        name: "Code Review Gate",
        status: "IN_PROGRESS",
        conclusion: null,
      })
    ).toMatchObject({ kind: "code-review-gate" });
    expect(
      mapRollupNode({
        __typename: "StatusContext",
        context: "Code Review Gate",
        state: "PENDING",
      })
    ).toMatchObject({ kind: "code-review-gate" });
  });

  it("maps StatusContext states and drops unknown typenames", () => {
    expect(
      mapRollupNode({
        __typename: "StatusContext",
        context: "ci",
        state: "EXPECTED",
      })
    ).toMatchObject({ kind: "pending", reportedState: "PENDING" });
    expect(
      mapRollupNode({
        __typename: "StatusContext",
        context: "ci",
        state: "FUTURE_VALUE",
      })
    ).toMatchObject({ kind: "failed", reportedState: "FUTURE_VALUE" });
    expect(mapRollupNode({ __typename: "FutureNode" })).toBeNull();
  });
});

describe("closed enum parsing", () => {
  const rawPullRequest = {
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    headRefOid: "head",
    headRefName: "feature",
    baseRefName: "main",
    state: "OPEN",
    mergedAt: null,
    isDraft: false,
  };

  it("accepts mergeStateStatus CONFLICTING", () => {
    expect(
      parsePullRequest(
        { ...rawPullRequest, mergeStateStatus: "CONFLICTING" },
        context
      ).mergeStateStatus
    ).toBe("CONFLICTING");
  });

  it("reads gh's empty reviewDecision as no decision rather than a parse failure", () => {
    expect(
      parsePullRequest({ ...rawPullRequest, reviewDecision: "" }, context)
        .reviewDecision
    ).toBeNull();
  });

  it("still rejects an unknown reviewDecision", () => {
    expect(() =>
      parsePullRequest({ ...rawPullRequest, reviewDecision: "MAYBE" }, context)
    ).toThrow(WatcherQueryError);
  });

  it("rejects unknown enum values as retryable errors carrying the raw value", () => {
    try {
      parsePullRequest(
        { ...rawPullRequest, mergeStateStatus: "FUTURE_STATE" },
        context
      );
      throw new Error("expected parser to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(WatcherQueryError);
      if (!(error instanceof WatcherQueryError)) throw error;
      expect(error.failure).toMatchObject({
        kind: "missing-key",
        retryable: true,
        rawValue: '"FUTURE_STATE"',
      });
    }
  });
});

it("annotates Bugbot threads with distinct review-pass counts", () => {
  const response = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: "one",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      body: "RUN_ID: run-1",
                      createdAt: "now",
                      path: "a.ts",
                      line: 1,
                      author: { login: "bugbot" },
                    },
                  ],
                },
              },
              {
                id: "two",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      body: "CURSOR_AUTOMATION_ID: run-2 severity high",
                      createdAt: "now",
                      path: null,
                      line: null,
                      author: { login: "cursor" },
                    },
                  ],
                },
              },
              {
                id: "resolved",
                isResolved: true,
                comments: {
                  nodes: [
                    {
                      body: "RUN_ID: run-3",
                      createdAt: "now",
                      path: null,
                      line: null,
                      author: { login: "bugbot" },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  const threads = parseReviewThreads(response);
  expect(threads).toHaveLength(2);
  expect(threads.map((thread) => thread.isBugbot)).toEqual([true, true]);
  expect(threads.map((thread) => thread.bugbotReviewPasses)).toEqual([3, 3]);
});

describe("context and stack discovery", () => {
  it("returns a fully explicit context without any reader call", async () => {
    const reader = fakeReader();
    expect(
      await resolveContext({
        reader,
        owner: "explicit",
        repo: "repo",
        pr: context.number,
      })
    ).toEqual({ owner: "explicit", repo: "repo", number: context.number });
    expect(reader.calls).toEqual([]);
  });

  it("uses the local origin before currentPr for an explicit number", async () => {
    const reader = fakeReader({ origin: { owner: "local", repo: "checkout" } });
    expect(
      await resolveContext({
        reader,
        owner: null,
        repo: null,
        pr: context.number,
      })
    ).toEqual({ owner: "local", repo: "checkout", number: context.number });
    expect(reader.calls).toEqual(["originRepo"]);
  });

  it("orders the connected stack bottom-to-top", () => {
    const ordered = orderStack(context, [
      {
        number: parsePrNumber(41),
        headRefName: "base-feature",
        baseRefName: "main",
      },
      {
        number: context.number,
        headRefName: "feature",
        baseRefName: "base-feature",
      },
      {
        number: parsePrNumber(43),
        headRefName: "upstack",
        baseRefName: "feature",
      },
    ]);
    expect(ordered.map((item) => Number(item.number))).toEqual([41, 42, 43]);
  });
});

const ghFixtureDirs: string[] = [];

afterEach(async () => {
  for (const directory of ghFixtureDirs.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

type ReviewThreadNode = {
  readonly id: string;
  readonly isResolved: boolean;
  readonly comments: {
    readonly nodes: readonly {
      readonly body: string;
      readonly createdAt: string;
      readonly path: string | null;
      readonly line: number | null;
      readonly author: { readonly login: string };
    }[];
  };
};

type ReviewThreadsPage = {
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
  readonly nodes: readonly ReviewThreadNode[];
};

function reviewThreadsResponse(page: ReviewThreadsPage) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: page,
        },
      },
    },
  };
}

const blockingThread = {
  id: "blocking-thread",
  isResolved: false,
  comments: {
    nodes: [
      {
        body: "please fix this",
        createdAt: "2026-08-11T00:00:00Z",
        path: "src/app.ts",
        line: 10,
        author: { login: "reviewer" },
      },
    ],
  },
} as const satisfies ReviewThreadNode;

async function withControllableGhPages<T>(
  pages: readonly ReviewThreadsPage[],
  operation: (callsPath: string) => Promise<T>
): Promise<T> {
  if (pages.length === 0) throw new Error("withControllableGhPages needs pages");
  const directory = await mkdtemp(join(tmpdir(), "watch-pr-gh-"));
  ghFixtureDirs.push(directory);
  const bin = join(directory, "bin");
  const callsPath = join(directory, "gh-calls.jsonl");
  const pagesPath = join(directory, "pages.json");
  await mkdir(bin);
  await writeFile(pagesPath, JSON.stringify(pages.map(reviewThreadsResponse)));

  const gh = join(bin, "gh");
  await writeFile(
    gh,
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from "node:fs";
const callsPath = ${JSON.stringify(callsPath)};
const pages = JSON.parse(readFileSync(${JSON.stringify(pagesPath)}, "utf8"));
const argv = process.argv.slice(2);
appendFileSync(
  callsPath,
  Buffer.from(argv.join("\\0"), "utf8").toString("base64") + "\\n"
);
const afterArg = argv.find((arg) => arg.startsWith("after="));
const after = afterArg === undefined ? null : afterArg.slice("after=".length);
let index = 0;
if (after !== null) {
  const prior = pages.findIndex(
    (page) => page.data.repository.pullRequest.reviewThreads.pageInfo.endCursor === after
  );
  if (prior < 0 || prior + 1 >= pages.length) {
    console.error(\`unexpected after cursor: \${after}\`);
    process.exit(2);
  }
  index = prior + 1;
}
process.stdout.write(JSON.stringify(pages[index]));
`
  );
  await chmod(gh, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  try {
    return await operation(callsPath);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
}

async function readGhCalls(callsPath: string): Promise<readonly string[][]> {
  const text = await readFile(callsPath, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      Buffer.from(line, "base64").toString("utf8").split("\0").filter(Boolean)
    );
}

describe("GhGitHubReader.reviewThreads pagination", () => {
  it("fetches every page with endCursor and returns a later-page blocker before readiness", async () => {
    const endCursor = "cursor-page-1";
    await withControllableGhPages(
      [
        {
          pageInfo: { hasNextPage: true, endCursor },
          nodes: [],
        },
        {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [blockingThread],
        },
      ],
      async (callsPath) => {
        const threads = await new GhGitHubReader().reviewThreads(context);
        const calls = await readGhCalls(callsPath);
        const afterArgs = calls.map(
          (argv) => argv.find((arg) => arg.startsWith("after=")) ?? null
        );

        expect(afterArgs).toEqual([null, `after=${endCursor}`]);
        expect(threads.map((thread) => thread.id)).toEqual(["blocking-thread"]);
        expect(threads[0]?.firstComment?.body).toBe("please fix this");
      }
    );
  });

  it("rejects hasNextPage without an endCursor instead of returning a READY-looking empty page", async () => {
    for (const endCursor of [null, ""] as const) {
      await withControllableGhPages(
        [
          {
            pageInfo: { hasNextPage: true, endCursor },
            nodes: [],
          },
        ],
        async () => {
          let caught: unknown;
          try {
            await new GhGitHubReader().reviewThreads(context);
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(WatcherQueryError);
          if (!(caught instanceof WatcherQueryError)) throw caught;
          expect(caught.failure.retryable).toBe(true);
        }
      );
    }
  });

  it("rejects a repeated endCursor instead of accepting duplicated page nodes", async () => {
    const endCursor = "cursor-loop";
    await withControllableGhPages(
      [
        {
          pageInfo: { hasNextPage: true, endCursor },
          nodes: [blockingThread],
        },
        {
          pageInfo: { hasNextPage: true, endCursor },
          nodes: [blockingThread],
        },
      ],
      async () => {
        let caught: unknown;
        try {
          await new GhGitHubReader().reviewThreads(context);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(WatcherQueryError);
        if (!(caught instanceof WatcherQueryError)) throw caught;
        expect(caught.failure.retryable).toBe(true);
      }
    );
  });
});
