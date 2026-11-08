import * as ts from "typescript";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve, relative, basename, dirname, extname } from "path";

export interface ExportedSymbolSignature {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable";
  paramCount?: number;
  paramsSummary?: string;
  returnType?: string;
  rawSignature?: string;
}

export interface ASTFingerprint {
  filePath: string;
  exists: boolean;
  byteSize: number;
  totalLines: number;
  anyKeywordCount: number;
  asAnyCount: number;
  tsIgnoreCount: number;
  blanketEslintDisableCount: number;
  exportedSymbols: string[];
  exportedSignatures: Record<string, ExportedSymbolSignature>;
  parseErrors?: string[];
}

export interface PatchIntegrityReport {
  filePath: string;
  passed: boolean;
  prePatch: ASTFingerprint;
  postPatch: ASTFingerprint;
  deltas: {
    anyIntroduced: number;
    asAnyIntroduced: number;
    tsIgnoreIntroduced: number;
    blanketEslintIntroduced: number;
    linesChanged: number;
  };
  violations: string[];
  semanticIntegrityPassed: boolean;
  renameIntegrityPassed: boolean;
  crossFileImportPassed: boolean;
  signatureIntegrityPassed: boolean;
  brokenDependents: string[];
  signatureMismatches: string[];
  rollbackRecommended: boolean;
}

/**
 * PatchIntegrityMonitor
 * Evaluates Pre-Patch vs Post-Patch AST to detect:
 * 1. Anti-Cheat Violations (newly introduced type cheats, @ts-ignore escapes, blanket linter disables)
 * 2. Semantic Integrity (dropped export symbols)
 * 3. Signature Integrity (breaking signature mutations on exported symbols)
 * 4. Rename Integrity (unaliased renames breaking callers)
 * 5. Cross-File Import Integrity (dependent files importing removed/altered symbols)
 */
export class PatchIntegrityMonitor {
  private repoRoot: string;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = resolve(repoRoot);
  }

  /**
   * Captures the AST fingerprint of a file on disk
   */
  public captureFingerprint(filePath: string): ASTFingerprint {
    const fullPath = join(this.repoRoot, filePath);
    if (!existsSync(fullPath)) {
      return {
        filePath,
        exists: false,
        byteSize: 0,
        totalLines: 0,
        anyKeywordCount: 0,
        asAnyCount: 0,
        tsIgnoreCount: 0,
        blanketEslintDisableCount: 0,
        exportedSymbols: [],
        exportedSignatures: {},
      };
    }

    const content = readFileSync(fullPath, "utf-8");
    return this.fingerprintContent(filePath, content);
  }

  /**
   * Evaluates a file content string directly to build an AST Fingerprint
   */
  public fingerprintContent(filePath: string, content: string): ASTFingerprint {
    const totalLines = content.split("\n").length;
    let anyKeywordCount = 0;
    let asAnyCount = 0;
    let tsIgnoreCount = 0;
    let blanketEslintDisableCount = 0;
    const exportedSymbols: string[] = [];
    const exportedSignatures: Record<string, ExportedSymbolSignature> = {};

    // 1. Comment Trivia Scanner (Only genuine comments, ignores strings like "as any")
    const lines = content.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
        if (/@ts-(?:ignore|nocheck|expect-error)\b/.test(line)) {
          tsIgnoreCount++;
        }
        if (/\/\*\s*eslint-disable\s*\*\//.test(line)) {
          blanketEslintDisableCount++;
        }
      }
    }

    // 2. Pure AST Parsing (immunizes against strings, templates, and identifiers)
    const scriptKind = filePath.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : filePath.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;

    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const parseDiags = (sourceFile as any).parseDiagnostics || [];
    const parseErrors: string[] = parseDiags.map((d: any) =>
      typeof d.messageText === "string" ? d.messageText : d.messageText?.messageText || "Syntax Error"
    );

    const visit = (node: ts.Node) => {
      // Direct AnyKeyword in type position (e.g. `x: any`, `foo(): any`)
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        anyKeywordCount++;
      }

      // Explicit AsExpression to any: `(foo as any)`
      if (ts.isAsExpression(node) && node.type && node.type.kind === ts.SyntaxKind.AnyKeyword) {
        asAnyCount++;
      }

      // Exported Functions
      if (ts.isFunctionDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const name = node.name ? node.name.text : "default";
        const params = node.parameters.map((p) => {
          const pName = p.name.getText(sourceFile);
          const pType = p.type ? p.type.getText(sourceFile) : "any";
          return `${pName}: ${pType}`;
        });
        const returnType = node.type ? node.type.getText(sourceFile) : "void";
        const rawSignature = `function ${name}(${params.join(", ")}): ${returnType}`;

        exportedSymbols.push(name);
        exportedSignatures[name] = {
          name,
          kind: "function",
          paramCount: node.parameters.length,
          paramsSummary: params.join(", "),
          returnType,
          rawSignature,
        };
      }

      // Exported Variables / Arrow Functions
      if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            exportedSymbols.push(name);

            if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
              const fn = decl.initializer;
              const params = fn.parameters.map((p) => {
                const pName = p.name.getText(sourceFile);
                const pType = p.type ? p.type.getText(sourceFile) : "any";
                return `${pName}: ${pType}`;
              });
              const returnType = fn.type ? fn.type.getText(sourceFile) : "any";
              exportedSignatures[name] = {
                name,
                kind: "function",
                paramCount: fn.parameters.length,
                paramsSummary: params.join(", "),
                returnType,
                rawSignature: `const ${name} = (${params.join(", ")}) => ${returnType}`,
              };
            } else {
              const typeText = decl.type ? decl.type.getText(sourceFile) : "unknown";
              exportedSignatures[name] = {
                name,
                kind: "variable",
                rawSignature: `const ${name}: ${typeText}`,
              };
            }
          }
        }
      }

      // Exported Classes
      if (ts.isClassDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const name = node.name ? node.name.text : "default";
        exportedSymbols.push(name);
        exportedSignatures[name] = {
          name,
          kind: "class",
          rawSignature: `class ${name}`,
        };
      }

      // Exported Interfaces
      if (ts.isInterfaceDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const name = node.name.text;
        exportedSymbols.push(name);
        exportedSignatures[name] = {
          name,
          kind: "interface",
          rawSignature: `interface ${name}`,
        };
      }

      // Exported Types
      if (ts.isTypeAliasDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const name = node.name.text;
        exportedSymbols.push(name);
        exportedSignatures[name] = {
          name,
          kind: "type",
          rawSignature: `type ${name}`,
        };
      }

      // Export Declarations (e.g. export { foo, bar as baz })
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const spec of node.exportClause.elements) {
          const expName = spec.name.text;
          exportedSymbols.push(expName);
          exportedSignatures[expName] = {
            name: expName,
            kind: "variable",
            rawSignature: spec.propertyName
              ? `export { ${spec.propertyName.text} as ${expName} }`
              : `export { ${expName} }`,
          };
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      filePath,
      exists: true,
      byteSize: Buffer.byteLength(content, "utf-8"),
      totalLines,
      anyKeywordCount,
      asAnyCount,
      tsIgnoreCount,
      blanketEslintDisableCount,
      exportedSymbols,
      exportedSignatures,
      parseErrors,
    };
  }

  /**
   * Scans other files across the repository to check if any file imports dropped or altered symbols.
   */
  public findCrossFileImportViolations(targetFilePath: string, droppedOrModifiedSymbols: string[]): string[] {
    if (droppedOrModifiedSymbols.length === 0) return [];

    const violations: string[] = [];
    const targetBase = basename(targetFilePath).replace(/\.[^.]+$/, "");
    const targetAbs = resolve(this.repoRoot, targetFilePath);

    const scanDir = (dir: string, depth: number = 0) => {
      if (depth > 5) return;
      if (!existsSync(dir)) return;

      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".gemini") {
            continue;
          }
          const full = join(dir, entry);
          const st = statSync(full);
          if (st.isDirectory()) {
            scanDir(full, depth + 1);
          } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
            if (resolve(full) === targetAbs) continue; // Skip the target file itself
            this.checkFileImports(full, targetBase, targetAbs, droppedOrModifiedSymbols, violations);
          }
        }
      } catch {
        // ignore scan errors
      }
    };

    scanDir(this.repoRoot);
    return violations;
  }

  /**
   * Parses an individual file's imports to check for broken symbol references
   */
  private checkFileImports(
    filePath: string,
    targetBase: string,
    targetAbs: string,
    brokenSymbols: string[],
    violations: string[]
  ): void {
    try {
      const content = readFileSync(filePath, "utf-8");
      // Fast heuristic check before full AST parse
      if (!content.includes(targetBase)) return;

      const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const parseDiags = (sourceFile as any).parseDiagnostics || [];
    const parseErrors: string[] = parseDiags.map((d: any) =>
      typeof d.messageText === "string" ? d.messageText : d.messageText?.messageText || "Syntax Error"
    );

      ts.forEachChild(sourceFile, (node) => {
        if (ts.isImportDeclaration(node)) {
          const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
          // Check if import path matches target file
          if (specifier.includes(targetBase)) {
            const clause = node.importClause;
            if (clause && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
              for (const element of clause.namedBindings.elements) {
                const importedName = element.propertyName ? element.propertyName.text : element.name.text;
                if (brokenSymbols.includes(importedName)) {
                  const relCaller = relative(this.repoRoot, filePath);
                  violations.push(
                    `Cross-File Import Broken: '${relCaller}' dosyası silinen/bozulan '${importedName}' sembolünü import ediyor!`
                  );
                }
              }
            }
          }
        }
      });
    } catch {
      // ignore individual parse errors
    }
  }

  /**
   * Compares pre-patch and post-patch fingerprints and returns an in-depth integrity verdict
   */
  public evaluate(
    pre: ASTFingerprint,
    post: ASTFingerprint,
    options: { checkCrossFileImports?: boolean } = { checkCrossFileImports: true }
  ): PatchIntegrityReport {
    const anyIntroduced = Math.max(0, post.anyKeywordCount - pre.anyKeywordCount);
    const asAnyIntroduced = Math.max(0, post.asAnyCount - pre.asAnyCount);
    const tsIgnoreIntroduced = Math.max(0, post.tsIgnoreCount - pre.tsIgnoreCount);
    const blanketEslintIntroduced = Math.max(0, post.blanketEslintDisableCount - pre.blanketEslintDisableCount);
    const linesChanged = Math.abs(post.totalLines - pre.totalLines);

    const violations: string[] = [];
    const brokenDependents: string[] = [];
    const signatureMismatches: string[] = [];

    // 1. Anti-Cheat Violations
    if (tsIgnoreIntroduced > 0) {
      violations.push(`Yeni // @ts-ignore veya @ts-nocheck eklendi (+${tsIgnoreIntroduced}) — Derleyici susturma hilesi!`);
    }

    if (asAnyIntroduced > 0) {
      violations.push(`Yeni 'as any' tip zorlaması eklendi (+${asAnyIntroduced}) — Sahte tip kaçamağı!`);
    }

    if (anyIntroduced > 0) {
      violations.push(`Yeni açık ': any' tipi eklendi (+${anyIntroduced}) — Tip güvenliği ihlali!`);
    }

    if (blanketEslintIntroduced > 0) {
      violations.push(`Yeni genel /* eslint-disable */ eklendi (+${blanketEslintIntroduced}) — Dosya geneli linter susturma!`);
    }

    // 2. Semantic Integrity (Dropped Export Symbols)
    const droppedExports = pre.exportedSymbols.filter((s) => !post.exportedSymbols.includes(s));
    const semanticIntegrityPassed = droppedExports.length === 0;

    if (!semanticIntegrityPassed) {
      if (post.parseErrors && post.parseErrors.length > 0) {
        violations.push(
          `Sözdizimi Hatası (Syntax Error): ${post.parseErrors[0]} (Bu hata nedeniyle '${droppedExports.join(", ")}' sembolü okunamadı)`
        );
      } else {
        violations.push(`Önemli export sembolleri kayboldu: ${droppedExports.join(", ")}`);
      }
    } else if (post.parseErrors && post.parseErrors.length > 0 && (!pre.parseErrors || pre.parseErrors.length === 0)) {
      violations.push(`Yeni sözdizimi hatası (Syntax Error) eklendi: ${post.parseErrors[0]}`);
    }

    // 3. Rename Integrity
    let renameIntegrityPassed = true;
    const addedExports = post.exportedSymbols.filter((s) => !pre.exportedSymbols.includes(s));
    if (droppedExports.length > 0 && addedExports.length > 0) {
      // Possible unaliased rename
      for (const dropped of droppedExports) {
        // Did the patch export an alias: `export { newName as dropped }`?
        const hasAlias = Object.values(post.exportedSignatures).some((sig) =>
          sig.rawSignature?.includes(`as ${dropped}`)
        );
        if (!hasAlias) {
          renameIntegrityPassed = false;
          violations.push(
            `Rename Integrity Violation: '${dropped}' sembolü kaldırıldı ve yerine eşdeğer geriye dönük alias sağlanmadı!`
          );
        }
      }
    }

    // 4. Signature Integrity (Breaking Signature Changes on existing exports)
    let signatureIntegrityPassed = true;
    for (const sym of pre.exportedSymbols) {
      if (post.exportedSymbols.includes(sym)) {
        const preSig = pre.exportedSignatures[sym];
        const postSig = post.exportedSignatures[sym];

        if (preSig && postSig && preSig.kind === "function" && postSig.kind === "function") {
          // If required parameter count decreased or parameter signature altered incompatibly
          if (preSig.paramCount !== undefined && postSig.paramCount !== undefined) {
            if (postSig.paramCount < preSig.paramCount) {
              signatureIntegrityPassed = false;
              const msg = `Breaking Signature Change: '${sym}' fonksiyon parametre sayısı azaltıldı (${preSig.paramCount} -> ${postSig.paramCount}). Çağrıcılar kırılabilir!`;
              signatureMismatches.push(msg);
              violations.push(msg);
            } else if (preSig.paramsSummary !== postSig.paramsSummary) {
              signatureIntegrityPassed = false;
              const msg = `Breaking Signature Change: '${sym}' parametre tipleri değişti! Önceden: (${preSig.paramsSummary}), Şimdi: (${postSig.paramsSummary})`;
              signatureMismatches.push(msg);
              violations.push(msg);
            }
          }

          if (preSig.returnType && postSig.returnType && preSig.returnType !== postSig.returnType) {
            if (preSig.returnType !== "any" && postSig.returnType === "void") {
              signatureIntegrityPassed = false;
              const msg = `Breaking Signature Change: '${sym}' dönüş tipi '${preSig.returnType}' iken '${postSig.returnType}' yapıldı!`;
              signatureMismatches.push(msg);
              violations.push(msg);
            }
          }
        }
      }
    }

    // 5. Cross-File Import Integrity (Check if other files in the repo import the affected symbols)
    let crossFileImportPassed = true;
    if (options.checkCrossFileImports && (droppedExports.length > 0 || signatureMismatches.length > 0)) {
      const affectedSymbols = [...droppedExports, ...signatureMismatches.map((m) => m.match(/'([^']+)'/)?.[1] || "")].filter(Boolean);
      const crossFileViolations = this.findCrossFileImportViolations(post.filePath, affectedSymbols);
      if (crossFileViolations.length > 0) {
        crossFileImportPassed = false;
        brokenDependents.push(...crossFileViolations);
        violations.push(...crossFileViolations);
      }
    }

    const passed = violations.length === 0;

    return {
      filePath: post.filePath,
      passed,
      prePatch: pre,
      postPatch: post,
      deltas: {
        anyIntroduced,
        asAnyIntroduced,
        tsIgnoreIntroduced,
        blanketEslintIntroduced,
        linesChanged,
      },
      violations,
      semanticIntegrityPassed,
      renameIntegrityPassed,
      crossFileImportPassed,
      signatureIntegrityPassed,
      brokenDependents,
      signatureMismatches,
      rollbackRecommended: !passed,
    };
  }
}
