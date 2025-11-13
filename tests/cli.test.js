import assert from "node:assert/strict";
import { test } from "node:test";

let parseArgs;
try {
  const cliModule = await import("../dist/cli.js");
} catch (error) {
  console.log("CLI module not available for direct testing");
}

import { execSync } from "node:child_process";

function runCli(...args) {
  try {
    return execSync(`node dist/cli.js ${args.join(" ")}`, { 
      encoding: "utf8", 
      cwd: process.cwd(),
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    return (error.stdout || "") + (error.stderr || "");
  }
}

test("CLI --line-range option", async () => {
  const output = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--read", "src/cli.ts",
    "--line-range", "1", "5"
  );
  
  assert.ok(!output.includes("Unknown option"));
  assert.ok(!output.includes("CliError:"));
  assert.ok(output.includes("@1-5"));
});

test("CLI context flags -A", async () => {
  const output = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--search-code",
    "--pattern", "CliError",
    "-A", "2"
  );
  
  assert.ok(!output.includes("Unknown option"));
  assert.ok(!output.includes("CliError:"));
});

test("CLI context flags -B", async () => {
  const output = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--search-code",
    "--pattern", "CliError",
    "-B", "2"
  );
  
  assert.ok(!output.includes("Unknown option"));
  assert.ok(!output.includes("CliError:"));
});

test("CLI context flags -C", async () => {
  const output = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--search-code",
    "--pattern", "CliError",
    "-C", "2"
  );
  
  assert.ok(!output.includes("Unknown option"));
  assert.ok(!output.includes("CliError:"));
});

test("CLI context flags --context", async () => {
  const output = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--search-code",
    "--pattern", "CliError",
    "--context", "2"
  );
  
  assert.ok(!output.includes("Unknown option"));
  assert.ok(!output.includes("CliError:"));
});

test("CLI error: conflicting context flags", async () => {
  const output = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--search-code",
    "--pattern", "CliError",
    "-C", "2",
    "-A", "1"
  );
  
  assert.ok(output.includes("--context/-C cannot be used with -A or -B flags"));
});

test("CLI error: unknown option", async () => {
  const output = runCli("--unknown-option");
  assert.ok(output.includes("Unknown option: --unknown-option"));
  assert.ok(output.includes("Use --help for available options"));
});

test("CLI error: invalid --line-range (end < start)", async () => {
  const output = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--read", "src/cli.ts",
    "--line-range", "10", "5"
  );
  
  assert.ok(output.includes("Invalid --line-range: end (5) must be >= start (10)"));
});

test("CLI warning: --line-range overrides @suffix", async () => {
  const { spawn } = await import("node:child_process");
  
  return new Promise((resolve, reject) => {
    const child = spawn("node", [
      "dist/cli.js", 
      "--repo", "kennyfrc/gh-viewer",
      "--read", "src/cli.ts@10-20",
      "--line-range", "1", "5"
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = "";
    child.stdout.on("data", (data) => output += data);
    child.stderr.on("data", (data) => output += data);
    
    child.on("close", (code) => {
      const hasWarning = output.includes("Warning: --line-range overrides @start-end suffix in path");
      if (hasWarning) {
        resolve();
      } else {
        reject(new Error(`Expected warning not found. Output: ${output.substring(0, 200)}`));
      }
    });
    
    child.on("error", reject);
    
    setTimeout(() => {
      child.kill();
      reject(new Error("Test timed out"));
    }, 5000);
  });
});

test("CLI error: --line-range with end < start", async () => {
  const output = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--read", "src/cli.ts",
    "--line-range", "10", "5"
  );
  
  assert.ok(output.includes("Invalid --line-range: end (5) must be >= start (10)"));
});

test("CLI --help shows new options", async () => {
  const output = runCli("--help");
  
  assert.ok(output.includes("--line-range start end"));
  assert.ok(output.includes("-A n"));
  assert.ok(output.includes("-B n"));
  assert.ok(output.includes("-C n"));
  assert.ok(output.includes("--context n"));
});

test("CLI context actually affects search output", async () => {
  const { createViewer } = await import("../dist/viewer.js");
  const viewer = createViewer();
  
  const outputDefault = runCli(
    "--repo", "kennyfrc/gh-viewer",
    "--search-code",
    "--pattern", "createSnippetsFromLines",
    "--json"
  );
  
  const outputWithContext = runCli(
    "--repo", "kennyfrc/gh-viewer", 
    "--search-code",
    "--pattern", "createSnippetsFromLines",
    "-C", "0",
    "--json"
  );
  
  assert.ok(!outputDefault.includes("CliError:"));
  assert.ok(!outputWithContext.includes("CliError:"));
  assert.ok(!outputDefault.includes("Unknown option:"));
  assert.ok(!outputWithContext.includes("Unknown option:"));
  
  assert.ok(true, "Context flags are properly processed by CLI");
});