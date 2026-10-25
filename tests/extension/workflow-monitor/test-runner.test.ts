import { describe, expect, test } from "vitest";
import { parseTestCommand, parseTestResult } from "../../../extensions/workflow-monitor/test-runner";

describe("parseTestCommand", () => {
  test("detects npm test", () => {
    expect(parseTestCommand("npm test")).toBe(true);
  });
  test("detects npx vitest", () => {
    expect(parseTestCommand("npx vitest run src/")).toBe(true);
  });
  test("detects pytest", () => {
    expect(parseTestCommand("pytest tests/")).toBe(true);
  });
  test("detects go test", () => {
    expect(parseTestCommand("go test ./...")).toBe(true);
  });
  test("detects cargo test", () => {
    expect(parseTestCommand("cargo test")).toBe(true);
  });
  test("detects jest", () => {
    expect(parseTestCommand("npx jest src/utils.test.ts")).toBe(true);
  });
  test("does not match ls", () => {
    expect(parseTestCommand("ls -la")).toBe(false);
  });
  test("does not match git commands", () => {
    expect(parseTestCommand("git status")).toBe(false);
  });
  test("does not match npm install", () => {
    expect(parseTestCommand("npm install")).toBe(false);
  });
});

describe("parseTestResult", () => {
  test("detects vitest pass", () => {
    expect(parseTestResult("Tests  1 passed", 0)).toBe(true);
  });
  test("detects vitest fail", () => {
    expect(parseTestResult("Tests  1 failed", 1)).toBe(false);
  });
  test("detects pytest pass", () => {
    expect(parseTestResult("1 passed in 0.5s", 0)).toBe(true);
  });
  test("detects pytest fail", () => {
    expect(parseTestResult("1 failed, 0 passed", 1)).toBe(false);
  });
  test("detects jest pass", () => {
    expect(parseTestResult("Tests:  1 passed, 1 total", 0)).toBe(true);
  });
  test("detects go test pass", () => {
    expect(parseTestResult("ok  \tgithub.com/user/pkg\t0.5s", 0)).toBe(true);
  });
  test("detects go test fail via FAIL prefix", () => {
    expect(parseTestResult("FAIL\tgithub.com/user/pkg", 1)).toBe(false);
  });
  test("uses exit code as fallback", () => {
    expect(parseTestResult("some unknown output", 0)).toBe(true);
    expect(parseTestResult("some unknown output", 1)).toBe(false);
  });
  test("returns null for ambiguous output with no exit code", () => {
    expect(parseTestResult("some unknown output", undefined)).toBeNull();
  });

  test("never accepts successful-looking output when the process or tool reports failure", () => {
    expect(parseTestResult("1 passed", 1)).toBe(false);
    expect(parseTestResult("1 passed", undefined, true)).toBe(false);
    expect(parseTestResult("1 passed", 0, true)).toBe(false);
    expect(parseTestResult("1 passed, 1 failed", 0, false)).toBe(false);
  });

  test("requires a confirmed success before trusting a pass-looking message", () => {
    expect(parseTestResult("1 passed", undefined)).toBeNull();
    expect(parseTestResult("1 passed", undefined, false)).toBe(true);
    expect(parseTestResult("1 passed", 0, false)).toBe(true);
  });

  test("does not match bare 'passed' without numeric prefix", () => {
    expect(parseTestResult("All checks passed", 0)).toBe(true);
    expect(parseTestResult("All checks passed", undefined)).toBeNull();
    // The pass-detection should rely on exit code, not bare "passed"
  });
});
