/**
 * Phase 6 auto-trigger hook: integration of MemoryExtractor + AppConfig flag
 * + post-turn proposal landing in the pending store.
 *
 * The wiring sits inside createForgeAgent's onStepFinish in src/core/agents/forge.ts.
 * Bootstrapping the full agent here would pull the entire LLM stack — instead
 * we re-implement the hook contract end-to-end against a stub model adapter
 * to exercise the same code path the real onStepFinish takes.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryExtractor } from "../src/core/memory/extractor.js";
import { MemoryManager } from "../src/core/memory/manager.js";

describe("Phase 6 auto-trigger contract", () => {
  let dir: string;
  let mgr: MemoryManager;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mem-auto-"));
    mgr = new MemoryManager(dir, join(dir, "home"));
  });
  afterEach(() => {
    mgr.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function runHook(opts: {
    enabled: boolean;
    finishReason: string;
    assistantText: string;
    userText: string;
    modelOutput: string;
    maxPerTurn?: number;
  }): Promise<void> {
    if (!opts.enabled) return;
    if (opts.finishReason !== "stop") return;
    if (opts.assistantText.trim().length < 80) return;
    if (!opts.userText.trim()) return;

    const extractor = new MemoryExtractor(async () => opts.modelOutput);
    const proposals = await extractor.proposeFromTurn(opts.userText, opts.assistantText);
    if (proposals.length === 0) return;
    const cap = opts.maxPerTurn ?? 3;
    mgr.addPending(proposals.slice(0, cap), "session-x", 0);
  }

  it("disabled flag → nothing extracted, pending stays empty", async () => {
    await runHook({
      enabled: false,
      finishReason: "stop",
      assistantText: "Long enough assistant output that would otherwise be considered for extraction.",
      userText: "user message",
      modelOutput: `[{"summary":"x","details":"","category":null,"topics":[],"file_paths":[]}]`,
    });
    expect(mgr.listPending()).toEqual([]);
  });

  it("finishReason != 'stop' → skipped (mid-turn tool call)", async () => {
    await runHook({
      enabled: true,
      finishReason: "tool-calls",
      assistantText: "x".repeat(120),
      userText: "user",
      modelOutput: `[{"summary":"x","details":"","category":null,"topics":[],"file_paths":[]}]`,
    });
    expect(mgr.listPending()).toEqual([]);
  });

  it("short assistant output (<80 chars) → skipped", async () => {
    await runHook({
      enabled: true,
      finishReason: "stop",
      assistantText: "ok.",
      userText: "user",
      modelOutput: `[{"summary":"x","details":"","category":null,"topics":[],"file_paths":[]}]`,
    });
    expect(mgr.listPending()).toEqual([]);
  });

  it("empty user message → skipped", async () => {
    await runHook({
      enabled: true,
      finishReason: "stop",
      assistantText: "x".repeat(120),
      userText: "   ",
      modelOutput: `[{"summary":"x","details":"","category":null,"topics":[],"file_paths":[]}]`,
    });
    expect(mgr.listPending()).toEqual([]);
  });

  it("happy path → proposals land in pending, cap respected", async () => {
    await runHook({
      enabled: true,
      finishReason: "stop",
      assistantText: "x".repeat(120),
      userText: "discussion of using bun instead of node, choosing sqlite for memory store",
      modelOutput: JSON.stringify([
        { summary: "use bun", details: "", category: "decision", topics: ["tooling"], file_paths: [] },
        { summary: "use sqlite for memory", details: "", category: "decision", topics: ["storage"], file_paths: [] },
        { summary: "extra-1", details: "", category: null, topics: [], file_paths: [] },
        { summary: "extra-2", details: "", category: null, topics: [], file_paths: [] },
      ]),
      maxPerTurn: 2,
    });
    const pending = mgr.listPending();
    expect(pending.length).toBe(2);
    expect(pending.map((p) => p.summary).sort()).toEqual(["use bun", "use sqlite for memory"]);
    expect(pending[0]!.source_session_id).toBe("session-x");
  });

  it("model returns garbage → pending stays empty (no throw)", async () => {
    await runHook({
      enabled: true,
      finishReason: "stop",
      assistantText: "x".repeat(120),
      userText: "user",
      modelOutput: "totally not json",
    });
    expect(mgr.listPending()).toEqual([]);
  });

  it("model returns [] → pending stays empty", async () => {
    await runHook({
      enabled: true,
      finishReason: "stop",
      assistantText: "x".repeat(120),
      userText: "user",
      modelOutput: "[]",
    });
    expect(mgr.listPending()).toEqual([]);
  });

  it("acceptPending after auto-extract writes a real memory", async () => {
    await runHook({
      enabled: true,
      finishReason: "stop",
      assistantText: "x".repeat(120),
      userText: "discussion",
      modelOutput: JSON.stringify([
        {
          summary: "auto-extracted",
          details: "from the turn",
          category: "context",
          topics: ["auto"],
          file_paths: [],
        },
      ]),
    });
    const pending = mgr.listPending();
    expect(pending.length).toBe(1);
    const accepted = mgr.acceptPending(pending[0]!.id, "project");
    expect(accepted).not.toBeNull();
    expect(accepted!.summary).toBe("auto-extracted");
    expect(mgr.listPending()).toEqual([]);
    expect(mgr.list("project").map((m) => m.summary)).toContain("auto-extracted");
  });
});
