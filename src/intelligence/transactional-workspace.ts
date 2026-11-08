import { createHash } from "crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "fs";
import { join, resolve } from "path";
import { PatchIntegrityMonitor } from "./patch-integrity";
import { BehavioralIntegrityEngine } from "./behavioral-integrity";

export interface WALEntry {
  txId: string;
  author: "user" | "ai-agent" | "healer" | "system";
  timestamp: string;
  state: "PREPARED" | "APPLIED" | "COMMITTED" | "ROLLED_BACK" | "ABORTED" | "RECOVERED";
  files: {
    path: string;
    preHash: string | null;
    postHash: string;
    preContent: string | null;
    postContent: string;
  }[];
  description?: string;
  error?: string;
}

export type FaultInjectionPoint =
  | "BEFORE_PREPARE"
  | "AFTER_PREPARE"
  | "DURING_FILE_WRITE"
  | "AFTER_FILE_WRITE"
  | "BEFORE_COMMIT"
  | "CORRUPT_WAL_ON_PREPARE";

export interface FaultInjectionConfig {
  point: FaultInjectionPoint;
  fileIndex?: number;
  errorType?: "CRASH" | "ENOSPC" | "EACCES" | "EIO";
  corruptWALBytes?: string;
}

export interface JournalRecord {
  txId: string;
  author: "user" | "ai-agent" | "healer" | "system";
  timestamp: string;
  status: "COMMITTED" | "ROLLED_BACK" | "ABORTED" | "RECOVERED" | "UNDONE";
  filesCount: number;
  files: string[];
  description: string;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * TransactionalWorkspaceEngine
 * Provides enterprise-grade crash recovery with physical fsync durability,
 * Write-Ahead Logging (WAL), optimistic concurrency locking, conflict-aware
 * undo/redo, and unified transaction management.
 */
export class TransactionalWorkspaceEngine {
  private repoRoot: string;
  private journalDir: string;
  private walFile: string;
  private integrityMonitor: PatchIntegrityMonitor;
  private behavioralEngine: BehavioralIntegrityEngine;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = resolve(repoRoot);
    this.journalDir = join(this.repoRoot, ".metaframe", "journal");
    this.walFile = join(this.journalDir, "wal.jsonl");
    this.integrityMonitor = new PatchIntegrityMonitor(this.repoRoot);
    this.behavioralEngine = new BehavioralIntegrityEngine(this.repoRoot);

    this.ensureStorage();
  }

  private ensureStorage(): void {
    if (!existsSync(this.journalDir)) {
      mkdirSync(this.journalDir, { recursive: true });
    }
  }

  public hash(content: string): string {
    return createHash("sha256").update(content, "utf-8").digest("hex");
  }

  /**
   * Durably writes file content to disk with physical fsync flush
   */
  public writeDurable(filePath: string, content: string): void {
    const fullPath = join(this.repoRoot, filePath);
    const fd = openSync(fullPath, "w");
    try {
      writeSync(fd, content, null, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Appends an atomic Write-Ahead Log (WAL) record with physical fsync disk flush
   */
  public logWAL(entry: WALEntry): void {
    this.ensureStorage();
    const line = JSON.stringify(entry) + "\n";
    const fd = openSync(this.walFile, "a");
    try {
      writeSync(fd, line, null, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Scans WAL for uncommitted / dangling transactions from prior crashes and idempotently recovers the workspace
   */
  public recoverCrash(): { recoveredCount: number; recoveredTxIds: string[] } {
    if (!existsSync(this.walFile)) {
      return { recoveredCount: 0, recoveredTxIds: [] };
    }

    const lines = readFileSync(this.walFile, "utf-8").trim().split("\n");
    const txStateMap = new Map<string, WALEntry>();

    // Process WAL in order; latest entry for each txId determines its effective state
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as WALEntry;
        txStateMap.set(entry.txId, entry);
      } catch {
        // ignore malformed line
      }
    }

    const recoveredTxIds: string[] = [];

    // Idempotent recovery: Any transaction whose LATEST recorded state is PREPARED or APPLIED
    for (const [txId, entry] of txStateMap.entries()) {
      if (entry.state === "PREPARED" || entry.state === "APPLIED") {
        console.warn(`[Crash Recovery] Dangling uncommitted transaction detected: ${txId} (state: ${entry.state}). Rolling back to baseline...`);

        // Revert files in reverse order with fsync durability
        for (let i = entry.files.length - 1; i >= 0; i--) {
          const file = entry.files[i];
          const fullPath = join(this.repoRoot, file.path);
          try {
            if (file.preContent === null) {
              if (existsSync(fullPath)) unlinkSync(fullPath);
            } else {
              this.writeDurable(file.path, file.preContent);
            }
          } catch (e: any) {
            console.error(`[Crash Recovery] Failed to revert ${file.path}: ${e.message}`);
          }
        }

        entry.state = "RECOVERED";
        this.logWAL({
          ...entry,
          timestamp: new Date().toISOString(),
          description: "Crash recovery: Reverted uncommitted transaction on startup",
        });

        recoveredTxIds.push(txId);
      }
    }

    if (recoveredTxIds.length > 0) {
      console.log(`[Crash Recovery] Successfully restored workspace integrity for ${recoveredTxIds.length} crashed transactions.`);
    }

    return { recoveredCount: recoveredTxIds.length, recoveredTxIds };
  }

  /**
   * Executes an atomic multi-file modification with full WAL, Optimistic Locking, and Rollback
   */
  public async executeTransaction(options: {
    author: "user" | "ai-agent" | "healer";
    description?: string;
    changes: Record<string, string>; // filePath -> newContent
    expectedBaseHashes?: Record<string, string>; // Optimistic locking
    skipBehavioralCheck?: boolean;
    customValidator?: () => Promise<{ passed: boolean; error?: string }> | { passed: boolean; error?: string };
    simulateCrashAfterFileIndex?: number; // Hook for crash-during-commit stress testing
    fault?: FaultInjectionConfig; // Universal fault injection hook
  }): Promise<{ success: boolean; txId: string; status: string; violations: string[]; error?: string }> {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();

    const filesToStage: WALEntry["files"] = [];
    const conflictFiles: string[] = [];
    const violations: string[] = [];

    // 0. Fault Injection: Before Prepare
    if (options.fault?.point === "BEFORE_PREPARE") {
      throw new Error("FAULT_INJECTION_CRASH: Process killed before WAL prepare");
    }
    if (options.fault?.point === "CORRUPT_WAL_ON_PREPARE") {
      this.ensureStorage();
      const torn = options.fault.corruptWALBytes || `{"txId":"${txId}","state":"PREPARED","files":[{`;
      const fd = openSync(this.walFile, "a");
      writeSync(fd, torn + "\n", null, "utf-8");
      fsyncSync(fd);
      closeSync(fd);
      throw new Error("FAULT_INJECTION_CRASH: Torn WAL written and process killed");
    }

    // 1. Snapshot original state & check Optimistic Locking
    for (const [filePath, newContent] of Object.entries(options.changes)) {
      const fullPath = join(this.repoRoot, filePath);
      const exists = existsSync(fullPath);
      const preContent = exists ? readFileSync(fullPath, "utf-8") : null;
      const preHash = preContent !== null ? this.hash(preContent) : null;
      const postHash = this.hash(newContent);

      if (options.expectedBaseHashes && options.expectedBaseHashes[filePath]) {
        if (preHash !== options.expectedBaseHashes[filePath]) {
          conflictFiles.push(filePath);
        }
      }

      filesToStage.push({
        path: filePath,
        preHash,
        postHash,
        preContent,
        postContent: newContent,
      });
    }

    if (conflictFiles.length > 0) {
      const errorMsg = `Optimistic Locking Conflict: ${conflictFiles.join(", ")} dosyaları dışarıdan değiştirildi!`;
      this.logWAL({
        txId,
        author: options.author,
        timestamp,
        state: "ABORTED",
        files: filesToStage,
        description: options.description || "Aborted due to concurrency conflict",
        error: errorMsg,
      });
      return { success: false, txId, status: "ABORTED", violations: [errorMsg], error: errorMsg };
    }

    // 2. Pre-Write AST & Anti-Cheat Validation (Skip for direct user saves)
    if (options.author !== "user") {
      for (const file of filesToStage) {
        if (file.preContent !== null) {
          const preFp = this.integrityMonitor.fingerprintContent(file.path, file.preContent);
          const postFp = this.integrityMonitor.fingerprintContent(file.path, file.postContent);
          const report = this.integrityMonitor.evaluate(preFp, postFp, { checkCrossFileImports: false });

          if (!report.passed) {
            violations.push(...report.violations.map((v) => `[${file.path}] ${v}`));
          }
        }
      }

      if (violations.length > 0) {
        this.logWAL({
          txId,
          author: options.author,
          timestamp,
          state: "ABORTED",
          files: filesToStage,
          description: options.description || "Aborted due to pre-write AST violations",
          error: violations.join(" | "),
        });
        return {
          success: false,
          txId,
          status: "ABORTED",
          violations,
          error: `Pre-Write Integrity Rejection: ${violations.join(" | ")}`,
        };
      }
    }

    // 3. Write-Ahead Logging: Durable fsync of PREPARED state to disk
    this.logWAL({
      txId,
      author: options.author,
      timestamp,
      state: "PREPARED",
      files: filesToStage,
      description: options.description,
    });

    if (options.fault?.point === "AFTER_PREPARE") {
      throw new Error("FAULT_INJECTION_CRASH: Process killed immediately after WAL prepare");
    }

    // 4. Capture Pre-Execution Behavioral Baseline
    const shouldCheckBehavior = !options.skipBehavioralCheck && options.author !== "user";
    const preBaseline = shouldCheckBehavior ? this.behavioralEngine.captureBaseline() : null;

    // 5. Apply Changes to Disk with Durable fsync
    const appliedFiles: string[] = [];
    try {
      this.logWAL({
        txId,
        author: options.author,
        timestamp: new Date().toISOString(),
        state: "APPLIED",
        files: filesToStage,
      });

      for (let i = 0; i < filesToStage.length; i++) {
        const file = filesToStage[i];

        // Fault injection hook: crash or IO failure during write loop
        if (options.fault?.point === "DURING_FILE_WRITE" && i === options.fault.fileIndex) {
          const errName = options.fault.errorType || "CRASH";
          throw new Error(`FAULT_INJECTION_${errName}: Failed during file write at index ${i}`);
        }

        // Stress testing hook: simulate crash midway during write loop
        if (options.simulateCrashAfterFileIndex !== undefined && i === options.simulateCrashAfterFileIndex) {
          throw new Error(`CRASH_SIMULATION: Process terminated midway after file index ${i}!`);
        }

        this.writeDurable(file.path, file.postContent);
        appliedFiles.push(file.path);
      }

      if (options.fault?.point === "AFTER_FILE_WRITE") {
        throw new Error("FAULT_INJECTION_CRASH: Process killed after writing files before commit");
      }
    } catch (writeErr: any) {
      if (writeErr.message.includes("CRASH") || writeErr.message.startsWith("CRASH_SIMULATION")) {
        // Process killed externally without user-space cleanup: leaves state for startup recovery
        throw writeErr;
      }

      // Normal disk write error -> Rollback immediately
      this.rollbackFiles(filesToStage, appliedFiles);
      this.logWAL({
        txId,
        author: options.author,
        timestamp: new Date().toISOString(),
        state: "ROLLED_BACK",
        files: filesToStage,
        error: writeErr.message,
      });
      return { success: false, txId, status: "ROLLED_BACK", violations: [writeErr.message], error: writeErr.message };
    }

    // 6. Post-Apply Verification (Behavioral & Quality Gates)
    if (shouldCheckBehavior && preBaseline) {
      const postBaseline = this.behavioralEngine.captureBaseline();
      const behavioralReport = this.behavioralEngine.evaluateRegression(preBaseline, postBaseline);

      if (!behavioralReport.passed) {
        this.rollbackFiles(filesToStage, appliedFiles);
        this.logWAL({
          txId,
          author: options.author,
          timestamp: new Date().toISOString(),
          state: "ROLLED_BACK",
          files: filesToStage,
          error: behavioralReport.summary,
        });
        return {
          success: false,
          txId,
          status: "ROLLED_BACK",
          violations: behavioralReport.regressionsDetected,
          error: behavioralReport.summary,
        };
      }
    }

    if (options.customValidator) {
      try {
        const customRes = await options.customValidator();
        if (!customRes.passed) {
          this.rollbackFiles(filesToStage, appliedFiles);
          this.logWAL({
            txId,
            author: options.author,
            timestamp: new Date().toISOString(),
            state: "ROLLED_BACK",
            files: filesToStage,
            error: customRes.error || "Quality Gate failure",
          });
          return {
            success: false,
            txId,
            status: "ROLLED_BACK",
            violations: [customRes.error || "Gate failed"],
            error: customRes.error,
          };
        }
      } catch (e: any) {
        this.rollbackFiles(filesToStage, appliedFiles);
        this.logWAL({
          txId,
          author: options.author,
          timestamp: new Date().toISOString(),
          state: "ROLLED_BACK",
          files: filesToStage,
          error: e.message,
        });
        return { success: false, txId, status: "ROLLED_BACK", violations: [e.message], error: e.message };
      }
    }

    if (options.fault?.point === "BEFORE_COMMIT") {
      throw new Error("FAULT_INJECTION_CRASH: Process killed right before logging COMMITTED");
    }

    // 7. Commit Transaction with physical fsync
    this.logWAL({
      txId,
      author: options.author,
      timestamp: new Date().toISOString(),
      state: "COMMITTED",
      files: filesToStage,
      description: options.description || "Transaction successfully committed",
    });

    return { success: true, txId, status: "COMMITTED", violations: [] };
  }

  /**
   * Undoes a previously committed transaction.
   * Includes UNDO CONFLICT GUARD: Aborts if any file was modified after this transaction!
   */
  public undoTransaction(
    txId: string,
    options?: { force?: boolean }
  ): { success: boolean; filesReverted: string[]; conflictFiles?: string[]; error?: string } {
    const entry = this.findCommittedTransaction(txId);
    if (!entry) {
      return { success: false, filesReverted: [], error: `Transaction ${txId} not found or not committed` };
    }

    // Undo Conflict Guard: Check if user or another transaction modified files after this transaction
    const conflictFiles: string[] = [];
    if (!options?.force) {
      for (const file of entry.files) {
        const fullPath = join(this.repoRoot, file.path);
        if (existsSync(fullPath)) {
          const currentContent = readFileSync(fullPath, "utf-8");
          const currentHash = this.hash(currentContent);
          // If current file hash != postHash of the transaction, external edits occurred!
          if (currentHash !== file.postHash) {
            conflictFiles.push(file.path);
          }
        }
      }
    }

    if (conflictFiles.length > 0) {
      return {
        success: false,
        filesReverted: [],
        conflictFiles,
        error: `Undo Conflict: [${conflictFiles.join(", ")}] dosyaları bu işlemden sonra değiştirildi! Kullanıcının yeni değişikliklerini ezmemek için Undo işlemi durduruldu.`,
      };
    }

    const filesReverted: string[] = [];
    for (let i = entry.files.length - 1; i >= 0; i--) {
      const file = entry.files[i];
      const fullPath = join(this.repoRoot, file.path);
      try {
        if (file.preContent === null) {
          if (existsSync(fullPath)) unlinkSync(fullPath);
        } else {
          this.writeDurable(file.path, file.preContent);
        }
        filesReverted.push(file.path);
      } catch (err: any) {
        return { success: false, filesReverted, error: `Failed to restore ${file.path}: ${err.message}` };
      }
    }

    this.logWAL({
      txId: `undo_${txId}`,
      author: "system",
      timestamp: new Date().toISOString(),
      state: "COMMITTED",
      files: entry.files.map((f) => ({
        path: f.path,
        preHash: f.postHash,
        postHash: f.preHash || "",
        preContent: f.postContent,
        postContent: f.preContent || "",
      })),
      description: `Undone transaction ${txId}`,
    });

    return { success: true, filesReverted };
  }

  /**
   * Re-applies a previously undone transaction with conflict guard
   */
  public redoTransaction(
    txId: string,
    options?: { force?: boolean }
  ): { success: boolean; filesApplied: string[]; conflictFiles?: string[]; error?: string } {
    const entry = this.findCommittedTransaction(txId);
    if (!entry) {
      return { success: false, filesApplied: [], error: `Transaction ${txId} not found` };
    }

    // Redo Conflict Guard: verify current content equals preContent
    const conflictFiles: string[] = [];
    if (!options?.force) {
      for (const file of entry.files) {
        const fullPath = join(this.repoRoot, file.path);
        if (existsSync(fullPath)) {
          const currentContent = readFileSync(fullPath, "utf-8");
          const currentHash = this.hash(currentContent);
          if (file.preHash && currentHash !== file.preHash) {
            conflictFiles.push(file.path);
          }
        }
      }
    }

    if (conflictFiles.length > 0) {
      return {
        success: false,
        filesApplied: [],
        conflictFiles,
        error: `Redo Conflict: [${conflictFiles.join(", ")}] dosyaları değiştirilmiş durumda!`,
      };
    }

    const filesApplied: string[] = [];
    for (const file of entry.files) {
      try {
        this.writeDurable(file.path, file.postContent);
        filesApplied.push(file.path);
      } catch (err: any) {
        return { success: false, filesApplied, error: `Failed to re-apply ${file.path}: ${err.message}` };
      }
    }

    this.logWAL({
      txId: `redo_${txId}`,
      author: "system",
      timestamp: new Date().toISOString(),
      state: "COMMITTED",
      files: entry.files,
      description: `Redone transaction ${txId}`,
    });

    return { success: true, filesApplied };
  }

  /**
   * Returns list of recent transactions for UI journal / history
   */
  public getJournal(limit: number = 30): JournalRecord[] {
    if (!existsSync(this.walFile)) return [];

    const lines = readFileSync(this.walFile, "utf-8").trim().split("\n");
    const recordsMap = new Map<string, JournalRecord>();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as WALEntry;
        if (entry.state === "COMMITTED" || entry.state === "ROLLED_BACK" || entry.state === "RECOVERED") {
          recordsMap.set(entry.txId, {
            txId: entry.txId,
            author: entry.author,
            timestamp: entry.timestamp,
            status: entry.state as any,
            filesCount: entry.files.length,
            files: entry.files.map((f) => f.path),
            description: entry.description || `Transaction ${entry.txId}`,
            canUndo: entry.state === "COMMITTED" && !entry.txId.startsWith("undo_"),
            canRedo: entry.txId.startsWith("undo_"),
          });
        }
      } catch {
        // ignore parse error
      }
    }

    return Array.from(recordsMap.values()).reverse().slice(0, limit);
  }

  private findCommittedTransaction(txId: string): WALEntry | null {
    if (!existsSync(this.walFile)) return null;
    const lines = readFileSync(this.walFile, "utf-8").trim().split("\n");

    let found: WALEntry | null = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as WALEntry;
        if (entry.txId === txId && entry.state === "COMMITTED") {
          found = entry;
        }
      } catch {
        // ignore
      }
    }
    return found;
  }

  private rollbackFiles(files: WALEntry["files"], appliedPaths: string[]): void {
    const appliedSet = new Set(appliedPaths);
    for (let i = files.length - 1; i >= 0; i--) {
      const file = files[i];
      if (!appliedSet.has(file.path)) continue;

      const fullPath = join(this.repoRoot, file.path);
      try {
        if (file.preContent === null) {
          if (existsSync(fullPath)) unlinkSync(fullPath);
        } else {
          this.writeDurable(file.path, file.preContent);
        }
      } catch (err: any) {
        console.error(`[Transactional Engine] Failed rollback for ${file.path}: ${err.message}`);
      }
    }
  }
}
