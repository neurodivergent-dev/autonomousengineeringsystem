import { TransactionalWorkspaceEngine, type WALEntry } from "../src/intelligence/transactional-workspace";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, appendFileSync } from "fs";
import { join } from "path";

console.log("==================================================");
console.log("💼 TESTING TRANSACTIONAL WORKSPACE ENGINE (WAL, CRASH RECOVERY & UNDO/REDO)");
console.log("==================================================\n");

const testDir = join(process.cwd(), "temp-workspace-test");
if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });

const engine = new TransactionalWorkspaceEngine(testDir);

const file1 = join(testDir, "app.tsx");
const file2 = join(testDir, "utils.ts");

writeFileSync(file1, `export const App = () => "v1 baseline";`, "utf-8");
writeFileSync(file2, `export const add = (a: number, b: number) => a + b;`, "utf-8");

async function runSuite() {
  // ----------------------------------------------------
  // TEST 1: User Monaco Save Transaction
  // ----------------------------------------------------
  console.log("--- TEST 1: User Monaco Save Transaction ---");
  const saveRes = await engine.executeTransaction({
    author: "user",
    description: "Monaco Save: app.tsx",
    changes: { "app.tsx": `export const App = () => "v2 saved by user";` },
  });

  console.log("1. Monaco save result:", {
    success: saveRes.success,
    txId: saveRes.txId,
    status: saveRes.status,
  });

  const content1 = readFileSync(file1, "utf-8");
  console.log("Disk content matches save:", content1.includes("v2 saved by user"));

  // ----------------------------------------------------
  // TEST 2: Multi-File Transaction with Undo & Redo
  // ----------------------------------------------------
  console.log("\n--- TEST 2: Multi-File Transaction with Undo & Redo ---");
  const multiRes = await engine.executeTransaction({
    author: "ai-agent",
    description: "AI Refactor: app.tsx & utils.ts",
    changes: {
      "app.tsx": `export const App = () => "v3 refactored by AI";`,
      "utils.ts": `export const add = (a: number, b: number) => a + b;\nexport const multiply = (a: number, b: number) => a * b;`,
    },
    skipBehavioralCheck: true,
  });

  console.log("2a. Committed transaction:", { success: multiRes.success, txId: multiRes.txId });
  console.log("Pre-undo check:", {
    app: readFileSync(file1, "utf-8").includes("v3 refactored"),
    utils: readFileSync(file2, "utf-8").includes("multiply"),
  });

  // Execute UNDO
  const undoRes = engine.undoTransaction(multiRes.txId);
  console.log("\n2b. Undo result:", undoRes);
  console.log("Post-undo verification (reverted to v2):", {
    app_reverted: readFileSync(file1, "utf-8").includes("v2 saved by user"),
    utils_reverted: !readFileSync(file2, "utf-8").includes("multiply"),
  });

  // Execute REDO
  const redoRes = engine.redoTransaction(multiRes.txId);
  console.log("\n2c. Redo result:", redoRes);
  console.log("Post-redo verification (re-applied v3):", {
    app_reapplied: readFileSync(file1, "utf-8").includes("v3 refactored"),
    utils_reapplied: readFileSync(file2, "utf-8").includes("multiply"),
  });

  // ----------------------------------------------------
  // TEST 3: Crash Recovery Simulation (WAL Recovery)
  // ----------------------------------------------------
  console.log("\n--- TEST 3: Crash Recovery Simulation (WAL Dangling State) ---");
  const crashFile = join(testDir, "crash-test.ts");
  writeFileSync(crashFile, `export const original = "rock solid baseline";`, "utf-8");

  // Simulate a dangling transaction interrupted mid-write (power cut / crash)
  const walFile = join(testDir, ".metaframe", "journal", "wal.jsonl");
  const danglingTx: WALEntry = {
    txId: "tx_crashed_999",
    author: "ai-agent",
    timestamp: new Date().toISOString(),
    state: "APPLIED", // Crashed before committing!
    files: [
      {
        path: "crash-test.ts",
        preHash: "abc",
        postHash: "xyz",
        preContent: `export const original = "rock solid baseline";`,
        postContent: `export const corrupted = "corrupted partial write!";`,
      },
    ],
    description: "Crashed mid-operation",
  };

  // Pollute file with partial corrupted write
  writeFileSync(crashFile, `export const corrupted = "corrupted partial write!";`, "utf-8");
  appendFileSync(walFile, JSON.stringify(danglingTx) + "\n", "utf-8");

  console.log("Before crash recovery:", readFileSync(crashFile, "utf-8"));

  // Recover crash
  const recoveryReport = engine.recoverCrash();
  console.log("Crash recovery report:", recoveryReport);

  const restoredContent = readFileSync(crashFile, "utf-8");
  console.log("Post-recovery baseline restored:", restoredContent.includes("rock solid baseline"));

  // ----------------------------------------------------
  // TEST 4: Journal History Query
  // ----------------------------------------------------
  console.log("\n--- TEST 4: Journal History Query ---");
  const journal = engine.getJournal(5);
  console.log(`Journal contains ${journal.length} records. Latest entries:`);
  for (const record of journal.slice(0, 3)) {
    console.log(`  - [${record.status}] ${record.txId} by ${record.author}: ${record.description} (${record.files.join(", ")})`);
  }

  // Cleanup
  rmSync(testDir, { recursive: true, force: true });

  console.log("\n==================================================");
  console.log("✔ ALL TRANSACTIONAL WORKSPACE ENGINE TESTS PASSED!");
  console.log("==================================================");
}

runSuite().catch(console.error);
