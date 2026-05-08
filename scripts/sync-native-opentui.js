#!/usr/bin/env bun
/**
 * Postinstall hook: sync native libraries from node_modules to ~/.soulforge/native/
 *
 * Ensures compiled binaries always find matching native libraries.
 * This runs automatically after every `bun install` / `npm install`.
 */

import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";

const PLATFORM = platform();
const BASE_ARCH = arch();

// Map architecture to package naming convention
function getArchSuffix() {
  if (BASE_ARCH === "arm64") return "arm64";
  return "x64";
}

function getExt() {
  return PLATFORM === "darwin" ? "dylib" : "so";
}

const pkgArch = getArchSuffix();
const libExt = getExt();
const destDir = join(homedir(), ".soulforge", "native", `${PLATFORM}-${BASE_ARCH}`);

// Ensure destination directory exists
mkdirSync(destDir, { recursive: true });

let synced = 0;

// 1. Sync @opentui/core native library (libopentui.so / libopentui.dylib)
const opentuiSrcDir = join(process.cwd(), "node_modules", `@opentui/core-${PLATFORM}-${pkgArch}`);
const opentuiSrcLib = join(opentuiSrcDir, `libopentui.${libExt}`);
const opentuiDstLib = join(destDir, `libopentui.${libExt}`);

if (existsSync(opentuiSrcLib)) {
  const tmp = opentuiDstLib + ".new";
  cpSync(opentuiSrcLib, tmp, { force: true });
  if (existsSync(opentuiDstLib)) rmSync(opentuiDstLib, { force: true });
  cpSync(tmp, opentuiDstLib, { force: true });
  rmSync(tmp, { force: true });
  console.log(`✓ Synced OpenTUI native library → ${opentuiDstLib}`);
  synced++;
} else {
  console.error(`⚠️  OpenTUI native library not found: ${opentuiSrcLib}`);
}

// 2. Sync ghostty-opentui native addon (ghostty-opentui.node)
const ghosttySrcDir = join(process.cwd(), "node_modules", "ghostty-opentui", "dist", `${PLATFORM}-${BASE_ARCH}`);
const ghosttySrcNode = join(ghosttySrcDir, "ghostty-opentui.node");
const ghosttyDstNode = join(destDir, "ghostty-opentui.node");

if (existsSync(ghosttySrcNode)) {
  const tmp = ghosttyDstNode + ".new";
  cpSync(ghosttySrcNode, tmp, { force: true });
  if (existsSync(ghosttyDstNode)) rmSync(ghosttyDstNode, { force: true });
  cpSync(tmp, ghosttyDstNode, { force: true });
  rmSync(tmp, { force: true });
  console.log(`✓ Synced ghostty-opentui.node → ${ghosttyDstNode}`);
  synced++;
} else {
  console.error(`⚠️  ghostty-opentui.node not found: ${ghosttySrcNode}`);
}

if (synced === 0) {
  console.error("❌ No native libraries were synced. Run 'bun install' to ensure dependencies are installed.");
  process.exit(1);
}
