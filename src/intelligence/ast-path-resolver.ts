import { existsSync, readFileSync } from "fs";
import { resolve, dirname, relative, basename } from "path";

export interface ImportFix {
  originalStatement: string;
  fixedStatement: string;
  reason: string;
}

export class ASTPathResolver {
  private static EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

  /**
   * Resolves whether a given file exists with any supported extension.
   */
  public static resolveFileExists(basePath: string): string | null {
    if (existsSync(basePath)) return basePath;
    for (const ext of this.EXTENSIONS) {
      const candidate = basePath.endsWith(ext) ? basePath : `${basePath}${ext}`;
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  /**
   * Scans and normalizes all imports in code:
   * 1. Fixes broken relative depths (./ vs ../).
   * 2. Locates files in subdirectories (e.g. ./components/Card -> ./components/ui/Card).
   * 3. Fixes named vs default export mismatches (import X vs import { X }).
   * 4. Strips disallowed .tsx/.ts file extensions from import specifiers.
   */
  public static normalizeImports(
    code: string,
    currentFilePath: string,
    targetRepo: string,
    allFiles: string[] = []
  ): { code: string; fixes: ImportFix[]; changes: string[] } {
    const fixes: ImportFix[] = [];
    const normalizedCurrent = currentFilePath.replace(/\\/g, "/");
    const currentDir = dirname(normalizedCurrent);
    const currentAbsDir = resolve(targetRepo, currentDir);

    // Regex to match imports:
    // Group 1: entire import statement up to semicolon/newline
    // Group 2: default import identifier (if any)
    // Group 3: named imports { ... } (if any)
    // Group 4: import specifier path (inside quotes)
    const importRegex = /import\s+(?:([a-zA-Z0-9_$]+)\s*,?\s*)?(?:\{([^}]+)\})?\s*(?:from\s*)?["']([^"']+)["'];?/g;

    let modifiedCode = code;

    // Match all import lines
    const matches = Array.from(code.matchAll(importRegex));

    for (const match of matches) {
      const fullMatch = match[0];
      const defaultImport = match[1]?.trim();
      const namedImports = match[2]?.trim();
      const specifier = match[3]?.trim();

      if (!specifier) continue;

      // Only inspect local/project imports
      const isLocal = specifier.startsWith(".") || specifier.startsWith("src/") || specifier.startsWith("@/");
      if (!isLocal) continue;

      // Normalize specifier path
      let cleanSpecifier = specifier.replace(/\.(?:tsx?|jsx?)$/, "");

      // 1. Check if the file exists directly as specified
      const directTargetAbs = resolve(currentAbsDir, cleanSpecifier);
      let resolvedTargetFile = this.resolveFileExists(directTargetAbs);

      let targetRelPathInProject: string | null = null;

      if (resolvedTargetFile) {
        targetRelPathInProject = relative(targetRepo, resolvedTargetFile).replace(/\\/g, "/");
      } else {
        // 2. File not found at specified path! Search in allFiles
        const importBaseName = basename(cleanSpecifier).toLowerCase();

        // Search for matching file in known source files
        const candidate = allFiles.find((f) => {
          const fBase = basename(f).replace(/\.(?:tsx?|jsx?)$/, "").toLowerCase();
          return fBase === importBaseName;
        });

        if (candidate) {
          targetRelPathInProject = candidate.replace(/\\/g, "/");
          resolvedTargetFile = resolve(targetRepo, candidate);
        }
      }

      if (!targetRelPathInProject) {
        continue;
      }

      // Compute exact relative path from current directory to target file
      let calculatedRelPath = relative(currentDir, targetRelPathInProject)
        .replace(/\\/g, "/")
        .replace(/\.(?:tsx?|jsx?)$/, "")
        .replace(/\/index$/, "");

      if (!calculatedRelPath.startsWith(".")) {
        calculatedRelPath = `./${calculatedRelPath}`;
      }

      // 3. Inspect target file exports to fix named vs default export mismatch if file exists on disk
      let correctedDefault: string | undefined = defaultImport;
      let correctedNamed: string | undefined = namedImports;

      if (resolvedTargetFile && existsSync(resolvedTargetFile)) {
        try {
          const targetContent = readFileSync(resolvedTargetFile, "utf-8");
          const hasDefaultExport = /export\s+default\s+/m.test(targetContent);

        // Check if symbol exists as named export
        const hasNamedExport = (name: string) => {
          const pattern = new RegExp(`export\\s+(?:const|function|class|type|interface)\\s+${name}\\b`);
          const namedListPattern = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
          return pattern.test(targetContent) || namedListPattern.test(targetContent);
        };

        // Case A: Used default import (import Foo from ...), but target only has named export (export function Foo)
        if (defaultImport && !hasDefaultExport && hasNamedExport(defaultImport)) {
          correctedDefault = undefined;
          correctedNamed = namedImports ? `${namedImports}, ${defaultImport}` : defaultImport;
        }

        // Case B: Used single named import (import { Foo } from ...), but target ONLY has export default Foo (no named export)
        if (!defaultImport && namedImports && !namedImports.includes(",") && hasDefaultExport) {
          const singleName = namedImports.trim();
          if (!hasNamedExport(singleName)) {
            correctedDefault = singleName;
            correctedNamed = undefined;
          }
        }
      } catch {}
    }

      // Reconstruct clean import statement
      let newImportParts: string[] = [];
      if (correctedDefault && correctedNamed) {
        newImportParts.push(`${correctedDefault}, { ${correctedNamed} }`);
      } else if (correctedDefault) {
        newImportParts.push(correctedDefault);
      } else if (correctedNamed) {
        newImportParts.push(`{ ${correctedNamed} }`);
      }

      const newStatement = newImportParts.length > 0
        ? `import ${newImportParts.join("")} from "${calculatedRelPath}";`
        : `import "${calculatedRelPath}";`;

      if (newStatement !== fullMatch && fullMatch.trim() !== newStatement.trim()) {
        modifiedCode = modifiedCode.replace(fullMatch, newStatement);
        fixes.push({
          originalStatement: fullMatch,
          fixedStatement: newStatement,
          reason: `Resolved path '${specifier}' -> '${calculatedRelPath}' and normalized exports.`,
        });
      }
    }

    return {
      code: modifiedCode,
      fixes,
      changes: fixes.map((f) => f.reason),
    };
  }
}
