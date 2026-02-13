import { describe, it, expect, beforeEach } from "vitest";
import { VerificationMonitor } from "../../../extensions/workflow-monitor/verification-monitor";

describe("VerificationMonitor", () => {
  let monitor: VerificationMonitor;

  beforeEach(() => {
    monitor = new VerificationMonitor();
  });

  describe("recordVerification", () => {
    it("records that verification was run", () => {
      monitor.recordVerification();
      expect(monitor.hasRecentVerification()).toBe(true);
    });
  });

  describe("hasRecentVerification", () => {
    it("returns false when no verification has been run", () => {
      expect(monitor.hasRecentVerification()).toBe(false);
    });

    it("returns false after reset", () => {
      monitor.recordVerification();
      monitor.reset();
      expect(monitor.hasRecentVerification()).toBe(false);
    });

    it("returns false after source file invalidates verification", () => {
      monitor.recordVerification();
      monitor.onSourceWritten();
      expect(monitor.hasRecentVerification()).toBe(false);
    });

    it("returns true when verification run after source write", () => {
      monitor.onSourceWritten();
      monitor.recordVerification();
      expect(monitor.hasRecentVerification()).toBe(true);
    });
  });

  describe("verification waiver", () => {
    it("waiver allows commit gate to pass", () => {
      monitor.recordVerificationWaiver();
      const result = monitor.checkCommitGate("git commit -m 'feat: stuff'");
      expect(result).toBeNull();
    });

    it("waiver allows push gate to pass", () => {
      monitor.recordVerificationWaiver();
      const result = monitor.checkCommitGate("git push origin main");
      expect(result).toBeNull();
    });

    it("waiver allows pr gate to pass", () => {
      monitor.recordVerificationWaiver();
      const result = monitor.checkCommitGate("gh pr create --title 'feat'");
      expect(result).toBeNull();
    });

    it("source write resets waiver", () => {
      monitor.recordVerificationWaiver();
      monitor.onSourceWritten();
      expect(monitor.hasRecentVerification()).toBe(false);
      const result = monitor.checkCommitGate("git commit -m 'fix'");
      expect(result).not.toBeNull();
    });

    it("reset clears waiver", () => {
      monitor.recordVerificationWaiver();
      monitor.reset();
      const result = monitor.checkCommitGate("git commit -m 'fix'");
      expect(result).not.toBeNull();
    });

    it("waiver does not affect hasRecentVerification", () => {
      monitor.recordVerificationWaiver();
      expect(monitor.hasRecentVerification()).toBe(false);
    });
  });

  describe("checkCommitGate", () => {
    it("returns violation when committing without verification", () => {
      const result = monitor.checkCommitGate("git commit -m 'feat: stuff'");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("commit-without-verification");
    });

    it("returns null when committing with recent verification", () => {
      monitor.recordVerification();
      const result = monitor.checkCommitGate("git commit -m 'feat: stuff'");
      expect(result).toBeNull();
    });

    it("detects git push", () => {
      const result = monitor.checkCommitGate("git push origin main");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("push-without-verification");
    });

    it("detects gh pr create", () => {
      const result = monitor.checkCommitGate("gh pr create --title 'feat'");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("pr-without-verification");
    });

    it("returns null for non-commit commands", () => {
      const result = monitor.checkCommitGate("ls -la");
      expect(result).toBeNull();
    });

    it("returns null for git add (not a commit)", () => {
      const result = monitor.checkCommitGate("git add .");
      expect(result).toBeNull();
    });

    it("returns violation after source write invalidates verification", () => {
      monitor.recordVerification();
      monitor.onSourceWritten();
      const result = monitor.checkCommitGate("git commit -m 'fix'");
      expect(result).not.toBeNull();
    });

    it("returns null for commit --amend with recent verification", () => {
      monitor.recordVerification();
      const result = monitor.checkCommitGate("git commit --amend");
      expect(result).toBeNull();
    });
  });
});
