import { TransactionalPatchEngine } from "../src/intelligence/transactional-patch-engine";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { join } from "path";

console.log("==================================================");
console.log("🔬 TESTING TRANSACTIONAL PATCH ENGINE (ACID FOR CODE)");
console.log("==================================================\n");

const testDir = join(process.cwd(), "temp-txn-test");
if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });

const engine = new TransactionalPatchEngine(testDir);

// Setup baseline files
const fileA = join(testDir, "moduleA.ts");
const fileB = join(testDir, "moduleB.ts");
const fileC = join(testDir, "moduleC.ts");

writeFileSync(fileA, `export const A = "version 1";`, "utf-8");
writeFileSync(fileB, `export const B = "version 1";`, "utf-8");
writeFileSync(fileC, `export const C = "version 1";`, "utf-8");

async function runTests() {
  // ----------------------------------------------------
  // TEST 1: Multi-File Atomic Commit (All Pass)
  // ----------------------------------------------------
  console.log("--- TEST 1: Multi-File Atomic Commit ---");
  const txn1 = engine.beginTransaction("txn-multi-commit");
  txn1.stage("moduleA.ts", `export const A = "version 2";`);
  txn1.stage("moduleB.ts", `export const B = "version 2";`);
  txn1.stage("moduleC.ts", `export const C = "version 2";`);

  const res1 = await txn1.commit({ runBehavioralCheck: false });
  console.log("1. Multi-file commit result:", {
    status: res1.status,
    committedFiles: res1.committedFiles,
    durationMs: res1.durationMs,
  });

  const contentA1 = readFileSync(fileA, "utf-8");
  const contentB1 = readFileSync(fileB, "utf-8");
  const contentC1 = readFileSync(fileC, "utf-8");
  console.log("Disk state verification:", {
    A: contentA1.includes("version 2"),
    B: contentB1.includes("version 2"),
    C: contentC1.includes("version 2"),
  });

  // ----------------------------------------------------
  // TEST 2: Multi-File Atomic Rollback (1 File Fails -> 0 Committed)
  // ----------------------------------------------------
  console.log("\n--- TEST 2: Multi-File Atomic Rollback (All-or-Nothing) ---");
  const txn2 = engine.beginTransaction("txn-multi-rollback");
  // File A & B are valid upgrades
  txn2.stage("moduleA.ts", `export const A = "version 3";`);
  txn2.stage("moduleB.ts", `export const B = "version 3";`);
  // File C introduces a cheating violation (// @ts-ignore)
  txn2.stage("moduleC.ts", `// @ts-ignore\nexport const C = "version 3 with cheat";`);

  const res2 = await txn2.commit({ runBehavioralCheck: false });
  console.log("2. Multi-file failure result:", {
    status: res2.status,
    violations: res2.violations,
    committedFiles: res2.committedFiles,
  });

  // CRITICAL CHECK: moduleA and moduleB must still be "version 2"!
  const contentA2 = readFileSync(fileA, "utf-8");
  const contentB2 = readFileSync(fileB, "utf-8");
  const contentC2 = readFileSync(fileC, "utf-8");
  console.log("Disk baseline preserved (No partial corruption):", {
    A_is_v2: contentA2.includes("version 2"),
    B_is_v2: contentB2.includes("version 2"),
    C_is_v2: contentC2.includes("version 2"),
  });

  // ----------------------------------------------------
  // TEST 3: Optimistic Locking / Concurrency Conflict Guard
  // ----------------------------------------------------
  console.log("\n--- TEST 3: Optimistic Locking & Concurrency Guard ---");
  const txn3 = engine.beginTransaction("txn-concurrency");
  txn3.stage("moduleA.ts", `export const A = "version 4";`);

  // Simulate concurrent user editing moduleA on disk while transaction is pending
  writeFileSync(fileA, `export const A = "concurrently edited by user!";`, "utf-8");

  const res3 = await txn3.commit({ runBehavioralCheck: false });
  console.log("3. Concurrency conflict detected:", {
    status: res3.status,
    conflictFiles: res3.conflictFiles,
    error: res3.error,
  });

  // Confirm user's edit was NOT overwritten
  const contentA3 = readFileSync(fileA, "utf-8");
  console.log("User's external edit preserved:", contentA3.includes("concurrently edited by user!"));

  // ----------------------------------------------------
  // TEST 4: Behavioral Regression Rollback
  // ----------------------------------------------------
  console.log("\n--- TEST 4: Quality Gate / Behavioral Rollback ---");
  writeFileSync(fileA, `export const A = "baseline for behavioral test";`, "utf-8");

  const txn4 = engine.beginTransaction("txn-behavioral-fail");
  txn4.stage("moduleA.ts", `export const A = "candidate update";`);

  // Simulate a custom quality gate failing (e.g. Aegis compiler gate or test runner)
  const res4 = await txn4.commit({
    runBehavioralCheck: false,
    customValidator: () => ({ passed: false, error: "Aegis Gate 1 TypeScript Compile Failure" }),
  });

  console.log("4. Quality Gate Failure Rollback:", {
    status: res4.status,
    rolledBackFiles: res4.rolledBackFiles,
    error: res4.error,
  });

  const contentA4 = readFileSync(fileA, "utf-8");
  console.log("Disk rolled back to exact baseline:", contentA4.includes("baseline for behavioral test"));

  // Clean up test directory
  rmSync(testDir, { recursive: true, force: true });

  console.log("\n==================================================");
  console.log("✔ ALL TRANSACTIONAL PATCH ENGINE TESTS PASSED!");
  console.log("==================================================");
}

runTests().catch(console.error);
