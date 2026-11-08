import { PatchIntegrityMonitor } from "../src/intelligence/patch-integrity";
import { BehavioralIntegrityEngine, type TestBaseline } from "../src/intelligence/behavioral-integrity";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

console.log("==================================================");
console.log("🛡️ RUNNING SEMANTIC, RENAME, IMPORT & BEHAVIORAL INTEGRITY TEST SUITE");
console.log("==================================================\n");

const monitor = new PatchIntegrityMonitor(process.cwd());
const behavioralEngine = new BehavioralIntegrityEngine(process.cwd());

// ----------------------------------------------------
// TEST 1: Rename Integrity (Unaliased vs Aliased)
// ----------------------------------------------------
console.log("--- TEST 1: Rename Integrity ---");
const codeV1 = `
export function formatCurrency(amount: number): string {
  return "$" + amount.toFixed(2);
}
`;

const codeRenamedUnaliased = `
export function formatMoney(amount: number): string {
  return "$" + amount.toFixed(2);
}
`;

const codeRenamedWithAlias = `
export function formatMoney(amount: number): string {
  return "$" + amount.toFixed(2);
}
export { formatMoney as formatCurrency };
`;

const fpV1 = monitor.fingerprintContent("currency.ts", codeV1);
const fpRenamed = monitor.fingerprintContent("currency.ts", codeRenamedUnaliased);
const reportRenameFail = monitor.evaluate(fpV1, fpRenamed, { checkCrossFileImports: false });

console.log("1a. Unaliased Rename (formatCurrency -> formatMoney):", {
  passed: reportRenameFail.passed,
  renameIntegrityPassed: reportRenameFail.renameIntegrityPassed,
  violations: reportRenameFail.violations,
});

const fpAliased = monitor.fingerprintContent("currency.ts", codeRenamedWithAlias);
const reportRenamePass = monitor.evaluate(fpV1, fpAliased, { checkCrossFileImports: false });

console.log("1b. Aliased Rename (with backwards-compatible export):", {
  passed: reportRenamePass.passed,
  renameIntegrityPassed: reportRenamePass.renameIntegrityPassed,
  violations: reportRenamePass.violations,
});

// ----------------------------------------------------
// TEST 2: Signature Integrity (Breaking Signature Mutations)
// ----------------------------------------------------
console.log("\n--- TEST 2: Signature Integrity (Breaking Mutations) ---");
const baseServiceCode = `
export function processPayment(userId: string, amount: number): boolean {
  return true;
}
`;

const mutatedParamsCode = `
export function processPayment(userId: string): boolean {
  return true;
}
`;

const mutatedReturnCode = `
export function processPayment(userId: string, amount: number): void {
  console.log(userId);
}
`;

const fpServiceBase = monitor.fingerprintContent("payment.ts", baseServiceCode);
const fpMutatedParams = monitor.fingerprintContent("payment.ts", mutatedParamsCode);
const reportParamBreak = monitor.evaluate(fpServiceBase, fpMutatedParams, { checkCrossFileImports: false });

console.log("2a. Function parameter dropped (userId, amount -> userId):", {
  passed: reportParamBreak.passed,
  signatureIntegrityPassed: reportParamBreak.signatureIntegrityPassed,
  signatureMismatches: reportParamBreak.signatureMismatches,
});

const fpMutatedReturn = monitor.fingerprintContent("payment.ts", mutatedReturnCode);
const reportReturnBreak = monitor.evaluate(fpServiceBase, fpMutatedReturn, { checkCrossFileImports: false });

console.log("2b. Return type changed (boolean -> void):", {
  passed: reportReturnBreak.passed,
  signatureIntegrityPassed: reportReturnBreak.signatureIntegrityPassed,
  signatureMismatches: reportReturnBreak.signatureMismatches,
});

// ----------------------------------------------------
// TEST 3: Cross-File Import Integrity
// ----------------------------------------------------
console.log("\n--- TEST 3: Cross-File Import Integrity ---");
const tempDir = join(process.cwd(), "temp-integrity-test");
if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

const targetFile = join(tempDir, "auth-service.ts");
const callerFile = join(tempDir, "login-page.tsx");

writeFileSync(targetFile, `export function authenticateUser(token: string): boolean { return true; }\nexport const AUTH_VERSION = "1.0";`, "utf-8");
writeFileSync(callerFile, `import { authenticateUser } from "./auth-service";\nexport function Login() { return authenticateUser("xyz"); }`, "utf-8");

const tempMonitor = new PatchIntegrityMonitor(tempDir);
const preAuth = tempMonitor.captureFingerprint("auth-service.ts");

// Candidate patch drops authenticateUser
const brokenAuthContent = `export const AUTH_VERSION = "2.0";`;
const postAuth = tempMonitor.fingerprintContent("auth-service.ts", brokenAuthContent);
const importReport = tempMonitor.evaluate(preAuth, postAuth, { checkCrossFileImports: true });

console.log("3. Target file dropped 'authenticateUser' imported by login-page.tsx:", {
  passed: importReport.passed,
  crossFileImportPassed: importReport.crossFileImportPassed,
  brokenDependents: importReport.brokenDependents,
  violations: importReport.violations,
});

// Clean up temp test files
unlinkSync(callerFile);
unlinkSync(targetFile);

// ----------------------------------------------------
// TEST 4: Behavioral Integrity Engine (Regression Detection)
// ----------------------------------------------------
console.log("\n--- TEST 4: Behavioral Integrity Engine ---");
const preTestBaseline: TestBaseline = {
  runner: "bun",
  total: 10,
  passed: 10,
  failed: 0,
  skipped: 0,
  durationMs: 120,
  failedTestNames: [],
};

// Scenario A: A patch breaks 2 existing tests
const postTestRegression: TestBaseline = {
  runner: "bun",
  total: 10,
  passed: 8,
  failed: 2,
  skipped: 0,
  durationMs: 135,
  failedTestNames: ["AuthSuite > token expiration test", "BillingSuite > calculate tax test"],
};

const regressionReport = behavioralEngine.evaluateRegression(preTestBaseline, postTestRegression);
console.log("4a. Behavioral Regression Simulation (10 passed -> 2 failed):", {
  passed: regressionReport.passed,
  regressionsDetected: regressionReport.regressionsDetected,
  rollbackRecommended: regressionReport.rollbackRecommended,
  summary: regressionReport.summary,
});

// Scenario B: Safe patch where all tests remain green
const postTestSuccess: TestBaseline = {
  runner: "bun",
  total: 11,
  passed: 11,
  failed: 0,
  skipped: 0,
  durationMs: 125,
  failedTestNames: [],
};

const successReport = behavioralEngine.evaluateRegression(preTestBaseline, postTestSuccess);
console.log("\n4b. Behavioral Pass (0 regressions, 1 new test passed):", {
  passed: successReport.passed,
  regressionsDetected: successReport.regressionsDetected,
  rollbackRecommended: successReport.rollbackRecommended,
  summary: successReport.summary,
});

console.log("\n==================================================");
console.log("✔ ALL INTEGRITY SUITE TESTS COMPLETED SUCCESSFULLY!");
console.log("==================================================");
