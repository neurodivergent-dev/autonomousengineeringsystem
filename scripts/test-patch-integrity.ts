import { PatchIntegrityMonitor } from "../src/intelligence/patch-integrity";

const monitor = new PatchIntegrityMonitor(process.cwd());

// Test 1: String containing "as any" and "@ts-ignore" inside string literals
const legacyCode = `
export const message = "as any";
export const warning = "Please do not use // @ts-ignore in comments";
export function calc(x: any) {
  return x;
}
`;

const pre1 = monitor.fingerprintContent("test.ts", legacyCode);

console.log("Test 1 (Legacy Code Baseline):", {
  anyKeywordCount: pre1.anyKeywordCount,
  asAnyCount: pre1.asAnyCount,
  tsIgnoreCount: pre1.tsIgnoreCount,
  blanketEslintDisableCount: pre1.blanketEslintDisableCount,
  exportedSymbols: pre1.exportedSymbols,
});

// Test 2: Safe patch adding clean TypeScript function
const safePatch = `
export const message = "as any";
export const warning = "Please do not use // @ts-ignore in comments";
export function calc(x: any) {
  return x;
}
export function add(a: number, b: number): number {
  return a + b;
}
`;

const post2 = monitor.fingerprintContent("test.ts", safePatch);
const report2 = monitor.evaluate(pre1, post2);
console.log("\nTest 2 (Safe Patch with preserved legacy any):", {
  passed: report2.passed,
  violations: report2.violations,
  deltas: report2.deltas,
});

// Test 3: Cheating patch that introduces "// @ts-ignore", "as any", and "/* eslint-disable */"
const cheatPatch = `
/* eslint-disable */
export const message = "as any";
export const warning = "Please do not use // @ts-ignore in comments";
// @ts-ignore
export function calc(x: any) {
  return (x as any).run();
}
`;

const post3 = monitor.fingerprintContent("test.ts", cheatPatch);
const report3 = monitor.evaluate(pre1, post3);
console.log("\nTest 3 (Cheating Patch with new cheats):", {
  passed: report3.passed,
  violations: report3.violations,
  rollbackRecommended: report3.rollbackRecommended,
});

// Test 4: Patch dropping an exported symbol
const droppedExportPatch = `
export const warning = "Please do not use // @ts-ignore in comments";
export function calc(x: any) {
  return x;
}
`;

const post4 = monitor.fingerprintContent("test.ts", droppedExportPatch);
const report4 = monitor.evaluate(pre1, post4);
console.log("\nTest 4 (Patch dropping 'message' export):", {
  passed: report4.passed,
  semanticIntegrityPassed: report4.semanticIntegrityPassed,
  violations: report4.violations,
});
