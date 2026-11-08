import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { PatchIntegrityMonitor, type PatchIntegrityReport, type ASTFingerprint } from "./patch-integrity";
import { BehavioralIntegrityEngine, type BehavioralIntegrityReport, type TestBaseline } from "./behavioral-integrity";

export interface StagedFileChange {
  filePath: string;
  originalContent: string | null;
  baseHash: string | null;
  stagedContent: string;
  stagedHash: string;
  integrityReport?: PatchIntegrityReport;
}

export type TransactionStatus =
  | "PENDING"
  | "STAGED"
  | "VALIDATING"
  | "COMMITTED"
  | "ABORTED"
  | "ROLLED_BACK";

export interface TransactionResult {
  transactionId: string;
  status: TransactionStatus;
  committedFiles: string[];
  rolledBackFiles: string[];
  conflictFiles: string[];
  violations: string[];
  behavioralReport?: BehavioralIntegrityReport;
  error?: string;
  durationMs: number;
}

/**
 * PatchTransaction
 * Represents a single atomic multi-file modification unit.
 * Guarantees All-or-Nothing atomicity, optimistic locking, and behavioral safety.
 */
export class PatchTransaction {
  public readonly id: string;
  public status: TransactionStatus = "PENDING";
  private repoRoot: string;
  private integrityMonitor: PatchIntegrityMonitor;
  private behavioralEngine: BehavioralIntegrityEngine;
  private stagedChanges: Map<string, StagedFileChange> = new Map();

  constructor(
    id: string,
    repoRoot: string,
    integrityMonitor: PatchIntegrityMonitor,
    behavioralEngine: BehavioralIntegrityEngine
  ) {
    this.id = id;
    this.repoRoot = repoRoot;
    this.integrityMonitor = integrityMonitor;
    this.behavioralEngine = behavioralEngine;
  }

  /**
   * Stages a file change in memory without touching the working tree
   */
  public stage(filePath: string, newContent: string): void {
    if (this.status !== "PENDING" && this.status !== "STAGED") {
      throw new Error(`Cannot stage files on transaction ${this.id} in state ${this.status}`);
    }

    const fullPath = join(this.repoRoot, filePath);
    const exists = existsSync(fullPath);
    const originalContent = exists ? readFileSync(fullPath, "utf-8") : null;
    const baseHash = originalContent !== null ? this.hash(originalContent) : null;
    const stagedHash = this.hash(newContent);

    this.stagedChanges.set(filePath, {
      filePath,
      originalContent,
      baseHash,
      stagedContent: newContent,
      stagedHash,
    });

    this.status = "STAGED";
  }

  /**
   * Stages multiple file changes simultaneously
   */
  public stageBatch(changes: Record<string, string>): void {
    for (const [filePath, content] of Object.entries(changes)) {
      this.stage(filePath, content);
    }
  }

  /**
   * Returns list of currently staged files
   */
  public getStagedFiles(): string[] {
    return Array.from(this.stagedChanges.keys());
  }

  /**
   * Executes the two-phase atomic commit pipeline:
   * Phase 1: Optimistic Locking & Multi-File AST/Anti-Cheat Validation
   * Phase 2: Trial Application & Behavioral Regression Check -> Commit or Atomic Rollback
   */
  public async commit(options?: {
    runBehavioralCheck?: boolean;
    customValidator?: () => Promise<{ passed: boolean; error?: string }> | { passed: boolean; error?: string };
  }): Promise<TransactionResult> {
    const startTime = Date.now();
    const shouldCheckBehavior = options?.runBehavioralCheck ?? true;
    this.status = "VALIDATING";

    const conflictFiles: string[] = [];
    const violations: string[] = [];
    const appliedFiles: string[] = [];

    // 1. Optimistic Locking Check (Concurrency guard against external edits)
    for (const [filePath, change] of this.stagedChanges.entries()) {
      const fullPath = join(this.repoRoot, filePath);
      const existsNow = existsSync(fullPath);

      if (change.originalContent === null && existsNow) {
        // File was created externally during transaction
        conflictFiles.push(filePath);
      } else if (change.originalContent !== null) {
        if (!existsNow) {
          conflictFiles.push(filePath);
        } else {
          const currentDiskContent = readFileSync(fullPath, "utf-8");
          const currentDiskHash = this.hash(currentDiskContent);
          if (currentDiskHash !== change.baseHash) {
            conflictFiles.push(filePath);
          }
        }
      }
    }

    if (conflictFiles.length > 0) {
      this.status = "ABORTED";
      const errorMsg = `Optimistic Locking Conflict: ${conflictFiles.join(", ")} dosyaları eşzamanlı olarak dışarıdan değiştirildi!`;
      return {
        transactionId: this.id,
        status: this.status,
        committedFiles: [],
        rolledBackFiles: [],
        conflictFiles,
        violations: [errorMsg],
        error: errorMsg,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Pre-Write Multi-File AST & Semantic Integrity Validation
    const stagedPaths = new Set(this.stagedChanges.keys());

    for (const [filePath, change] of this.stagedChanges.entries()) {
      if (change.originalContent !== null) {
        const preFp = this.integrityMonitor.fingerprintContent(filePath, change.originalContent);
        const postFp = this.integrityMonitor.fingerprintContent(filePath, change.stagedContent);
        const report = this.integrityMonitor.evaluate(preFp, postFp, { checkCrossFileImports: false });

        change.integrityReport = report;

        if (!report.passed) {
          violations.push(`[${filePath}] ${report.violations.join("; ")}`);
        }

        // Cross-file import check, taking transaction co-staged files into account
        if (report.brokenDependents && report.brokenDependents.length > 0) {
          for (const depViolation of report.brokenDependents) {
            // If the dependent file is also staged in this transaction, it is updating together
            const match = depViolation.match(/'([^']+)'/);
            const callerPath = match ? match[1] : null;
            if (!callerPath || !stagedPaths.has(callerPath)) {
              violations.push(`[${filePath}] ${depViolation}`);
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      this.status = "ABORTED";
      const errorMsg = `Pre-Write Integrity Rejection: ${violations.join(" | ")}`;
      return {
        transactionId: this.id,
        status: this.status,
        committedFiles: [],
        rolledBackFiles: [],
        conflictFiles: [],
        violations,
        error: errorMsg,
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Capture Pre-Execution Behavioral Baseline
    let preBaseline: TestBaseline | null = null;
    if (shouldCheckBehavior) {
      preBaseline = this.behavioralEngine.captureBaseline();
    }

    // 4. Trial Application to Working Tree
    try {
      for (const [filePath, change] of this.stagedChanges.entries()) {
        const fullPath = join(this.repoRoot, filePath);
        writeFileSync(fullPath, change.stagedContent, "utf-8");
        appliedFiles.push(filePath);
      }
    } catch (writeErr: any) {
      // Disk write failure -> rollback any partially written files
      this.rollbackApplied(appliedFiles);
      this.status = "ROLLED_BACK";
      return {
        transactionId: this.id,
        status: this.status,
        committedFiles: [],
        rolledBackFiles: appliedFiles,
        conflictFiles: [],
        violations: [`Disk write failure: ${writeErr.message}`],
        error: writeErr.message,
        durationMs: Date.now() - startTime,
      };
    }

    // 5. Post-Application Behavioral & Custom Gate Validation
    let behavioralReport: BehavioralIntegrityReport | undefined;

    if (shouldCheckBehavior && preBaseline) {
      const postBaseline = this.behavioralEngine.captureBaseline();
      behavioralReport = this.behavioralEngine.evaluateRegression(preBaseline, postBaseline);

      if (!behavioralReport.passed) {
        // Behavioral regression detected -> ATOMIC ROLLBACK
        this.rollbackApplied(appliedFiles);
        this.status = "ROLLED_BACK";
        return {
          transactionId: this.id,
          status: this.status,
          committedFiles: [],
          rolledBackFiles: appliedFiles,
          conflictFiles: [],
          violations: behavioralReport.regressionsDetected,
          behavioralReport,
          error: behavioralReport.summary,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Optional custom gate validator (e.g. 6-Gate suite)
    if (options?.customValidator) {
      try {
        const customResult = await options.customValidator();
        if (!customResult.passed) {
          this.rollbackApplied(appliedFiles);
          this.status = "ROLLED_BACK";
          return {
            transactionId: this.id,
            status: this.status,
            committedFiles: [],
            rolledBackFiles: appliedFiles,
            conflictFiles: [],
            violations: [customResult.error || "Custom quality gate failed"],
            behavioralReport,
            error: customResult.error || "Quality Gate failure triggered atomic rollback",
            durationMs: Date.now() - startTime,
          };
        }
      } catch (valErr: any) {
        this.rollbackApplied(appliedFiles);
        this.status = "ROLLED_BACK";
        return {
          transactionId: this.id,
          status: this.status,
          committedFiles: [],
          rolledBackFiles: appliedFiles,
          conflictFiles: [],
          violations: [valErr.message],
          behavioralReport,
          error: valErr.message,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // 6. All Verifications Passed -> TRANSACTION COMMITTED!
    this.status = "COMMITTED";
    return {
      transactionId: this.id,
      status: this.status,
      committedFiles: appliedFiles,
      rolledBackFiles: [],
      conflictFiles: [],
      violations: [],
      behavioralReport,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Reverts all applied files back to their exact snapshot contents in reverse order
   */
  private rollbackApplied(files: string[]): void {
    for (let i = files.length - 1; i >= 0; i--) {
      const filePath = files[i];
      const change = this.stagedChanges.get(filePath);
      if (!change) continue;

      const fullPath = join(this.repoRoot, filePath);
      try {
        if (change.originalContent === null) {
          // File did not exist originally -> delete
          if (existsSync(fullPath)) unlinkSync(fullPath);
        } else {
          // Restore exact baseline content
          writeFileSync(fullPath, change.originalContent, "utf-8");
        }
      } catch (err: any) {
        console.error(`[Transactional Engine] Failed to rollback ${filePath}: ${err.message}`);
      }
    }
  }

  private hash(content: string): string {
    return createHash("sha256").update(content, "utf-8").digest("hex");
  }
}

/**
 * TransactionalPatchEngine
 * Entry point for managing transactional patches across the codebase.
 */
export class TransactionalPatchEngine {
  private repoRoot: string;
  private integrityMonitor: PatchIntegrityMonitor;
  private behavioralEngine: BehavioralIntegrityEngine;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = resolve(repoRoot);
    this.integrityMonitor = new PatchIntegrityMonitor(this.repoRoot);
    this.behavioralEngine = new BehavioralIntegrityEngine(this.repoRoot);
  }

  /**
   * Begins a new atomic transaction
   */
  public beginTransaction(id?: string): PatchTransaction {
    const txnId = id || `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return new PatchTransaction(txnId, this.repoRoot, this.integrityMonitor, this.behavioralEngine);
  }

  /**
   * Executes a callback within an isolated transaction, committing on success or rolling back on error
   */
  public async runTransaction<T>(
    operation: (txn: PatchTransaction) => Promise<T> | T,
    options?: { runBehavioralCheck?: boolean }
  ): Promise<{ result?: T; transaction: TransactionResult }> {
    const txn = this.beginTransaction();
    try {
      const opResult = await operation(txn);
      const txnResult = await txn.commit(options);
      return { result: opResult, transaction: txnResult };
    } catch (err: any) {
      return {
        transaction: {
          transactionId: txn.id,
          status: "ABORTED",
          committedFiles: [],
          rolledBackFiles: [],
          conflictFiles: [],
          violations: [err.message],
          error: err.message,
          durationMs: 0,
        },
      };
    }
  }
}
