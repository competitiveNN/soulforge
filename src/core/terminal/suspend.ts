import { spawn } from "node:child_process";
import { getActiveRenderer } from "../../index.js";

interface SuspendOpts {
  command: string;
  args?: string[];
  cwd?: string;
  noAltScreen?: boolean;
}

export function suspendAndRun(opts: SuspendOpts): Promise<{ exitCode: number | null }> {
  return new Promise((resolve) => {
    // Get the active renderer (set in src/index.tsx) so we can suspend it.
    // suspend() disables mouse tracking, kitty keyboard protocol, raw mode,
    // and pauses the render loop — without this, lazygit's TTY input fights
    // OpenTUI's input parser and the child appears frozen.
    const renderer = (() => {
      try {
        return getActiveRenderer();
      } catch {
        return null;
      }
    })();

    try {
      renderer?.suspend();
    } catch {}

    // Belt-and-braces: even if renderer.suspend() leaves something raw,
    // explicitly drop raw mode so the child gets cooked-mode input.
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {}
    }

    // Enter alt screen buffer (unless disabled for non-TUI commands).
    // lazygit manages its own alt screen, so this is mostly for legacy
    // callers that pass noAltScreen: true.
    if (!opts.noAltScreen) {
      process.stdout.write("\x1b[?1049h");
    }

    const proc = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd ?? process.cwd(),
      stdio: "inherit",
      env: { ...process.env },
    });

    const restore = (code: number | null) => {
      if (!opts.noAltScreen) {
        process.stdout.write("\x1b[?1049l");
      }
      try {
        renderer?.resume();
      } catch {}
      // resume() re-enables raw mode + kitty keyboard. Belt-and-braces
      // in case the renderer is gone for some reason.
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          process.stdin.resume();
        } catch {}
      }
      resolve({ exitCode: code });
    };

    proc.on("close", (code) => restore(code));
    proc.on("error", () => restore(null));
  });
}
