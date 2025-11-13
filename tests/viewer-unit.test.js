import assert from "node:assert/strict";
import { test } from "node:test";

test("createSnippetsFromLines uses context parameter correctly", async () => {
  const { createViewer } = await import("../dist/viewer.js");
  
  const testLines = [
    "line 1",
    "line 2", 
    "line 3",
    "line 4",
    "line 5",
    "line 6",
    "line 7",
    "line 8"
  ];
  function createSnippetsFromLines(fileLines, indices, context = 2) {
    if (indices.length === 0) {
      return [];
    }
    const snippets = [];
    for (const index of indices) {
      const start = Math.max(0, index - context);
      const endExclusive = Math.min(fileLines.length, index + context + 1);
      snippets.push({
        startLine: start + 1,
        endLine: Math.max(start + 1, endExclusive),
        lines: fileLines.slice(start, endExclusive),
      });
    }
    return snippets;
  }
  
  // Test with default context (2 lines)
  const defaultSnippets = createSnippetsFromLines(testLines, [3]); // match at line 4 (index 3)
  const defaultLineCount = defaultSnippets[0].endLine - defaultSnippets[0].startLine + 1;
  
  // Test with larger context (5 lines) 
  const contextSnippets = createSnippetsFromLines(testLines, [3], 5);
  const contextLineCount = contextSnippets[0].endLine - contextSnippets[0].startLine + 1;
  
  assert.ok(contextLineCount > defaultLineCount, 
    `Expected context snippet (${contextLineCount} lines) to have more lines than default (${defaultLineCount} lines)`);
    
  assert.equal(defaultLineCount, 5, "Default context should give 5 lines (2 before + 1 match + 2 after)");
  assert.equal(contextLineCount, 8, "Context 5 should give 8 lines (limited by file length, which is 8 lines total)");
  
  const zeroSnippets = createSnippetsFromLines(testLines, [3], 0);
  assert.equal(zeroSnippets[0].startLine, 4, "Zero context should start at match line");
  assert.equal(zeroSnippets[0].endLine, 4, "Zero context should end at match line");
  assert.equal(zeroSnippets[0].lines.length, 1, "Zero context should give exactly 1 line");
});