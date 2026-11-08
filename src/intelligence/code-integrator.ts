import { SurgicalPatchEngine } from "./surgical-patch";

export interface IntegrationResult {
  success: boolean;
  finalCode: string;
  mode: "full_rewrite" | "surgical_function" | "surgical_import" | "surgical_hunk" | "rejected";
  reason?: string;
  linesBefore: number;
  linesAfter: number;
}

export class SmartCodeIntegrator {
  /**
   * Intelligently integrates incoming code into existing code:
   * 1. Protects against catastrophic truncation (replacing a 100-line file with a 1-line snippet).
   * 2. Surgically replaces only matching functions/components when a snippet is provided.
   * 3. Injects missing imports without deleting other code.
   * 4. Preserves untouched imports when full component rewrites miss them.
   */
  public static integrate(existingCode: string, incomingCode: string, targetFile: string): IntegrationResult {
    const rawIncoming = incomingCode.trim();
    const rawExisting = existingCode.trim();

    const existingLines = rawExisting.length > 0 ? rawExisting.split("\n").length : 0;
    const incomingLines = rawIncoming.split("\n").length;

    // Case 1: Target file does not exist or is empty -> Safe full write
    if (rawExisting.length === 0) {
      return {
        success: true,
        finalCode: rawIncoming,
        mode: "full_rewrite",
        linesBefore: 0,
        linesAfter: incomingLines,
      };
    }

    // Case 1b: Anti-Placeholder Shield
    // If incomingCode contains placeholder comments (e.g. // ... (önceki kodlar), {/* ... */}),
    // NEVER allow it to replace or overwrite existing code, as that would permanently delete real code!
    const placeholder = this.hasPlaceholders(rawIncoming);
    if (placeholder.found && rawExisting.length > 0) {
      return {
        success: false,
        finalCode: rawExisting,
        mode: "rejected",
        reason: `⚠️ Yer Tutucu Engellendi: Kod bloğunda '${placeholder.match}' yer tutucusu tespit edildi. Bu kodu uygulamak dosyadaki mevcut gerçek kodların (JSX, fonksiyonlar, menüler) silinmesine yol açardı. Orijinal dosya korundu. Lütfen AI'dan kodu 'yer tutucu olmadan, baştan sona eksiksiz' üretmesini isteyin.`,
        linesBefore: existingLines,
        linesAfter: existingLines,
      };
    }

    // Case 2: Check for standard surgical SEARCH/REPLACE hunks
    if (rawIncoming.includes("<<<<<<< SEARCH")) {
      const hunks = SurgicalPatchEngine.parseHunks(rawIncoming);
      if (hunks.length > 0) {
        const patchRes = SurgicalPatchEngine.applyHunks(rawExisting, hunks);
        if (patchRes.success) {
          return {
            success: true,
            finalCode: patchRes.patchedContent,
            mode: "surgical_hunk",
            linesBefore: existingLines,
            linesAfter: patchRes.patchedContent.split("\n").length,
          };
        }
      }
    }

    // Case 3: Identify if incomingCode is a Partial Snippet vs Full File Replacement
    const hasImports = /^\s*import\s+/m.test(rawIncoming);
    const isFragment = (
      (!hasImports && (incomingLines < existingLines * 0.6 || incomingLines <= 15)) ||
      (existingLines >= 30 && incomingLines < existingLines * 0.45 && rawIncoming.length < rawExisting.length * 0.45)
    );

    if (isFragment) {
      // Strategy 3A: Is it a single import statement?
      if (/^\s*import\s+.*from\s+["'].*["'];?$/m.test(rawIncoming)) {
        if (!rawExisting.includes(rawIncoming)) {
          const firstImportIdx = rawExisting.indexOf("import ");
          let patched = "";
          if (firstImportIdx !== -1) {
            patched = `${rawIncoming}\n${rawExisting}`;
          } else {
            patched = `${rawIncoming}\n\n${rawExisting}`;
          }
          return {
            success: true,
            finalCode: patched,
            mode: "surgical_import",
            linesBefore: existingLines,
            linesAfter: patched.split("\n").length,
          };
        }
        return {
          success: true,
          finalCode: rawExisting,
          mode: "surgical_import",
          reason: "Import already exists",
          linesBefore: existingLines,
          linesAfter: existingLines,
        };
      }

      // Strategy 3B: Is it a named function, const component, or class?
      const funcMatch = rawIncoming.match(/(?:export\s+)?(?:default\s+)?(?:const|function|class)\s+([A-Za-z0-9_]+)\b/);
      if (funcMatch && funcMatch[1]) {
        const identifier = funcMatch[1];
        // Find existing function bounds using bracket matching
        const funcPos = rawExisting.search(new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:const|function|class)\\s+${identifier}\\b`));
        if (funcPos !== -1) {
          const funcEnd = this.findMatchingClosingBrace(rawExisting, funcPos);
          if (funcEnd !== -1) {
            // Extract the function part from incoming
            const incomingFuncPos = rawIncoming.search(new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:const|function|class)\\s+${identifier}\\b`));
            const incomingFuncCode = incomingFuncPos !== -1 ? rawIncoming.slice(incomingFuncPos) : rawIncoming;

            // Extract any imports in incoming and inject missing ones
            const incomingImports = rawIncoming.match(/import\s+.*from\s+["'][^"']+["'];?/g) || [];
            let baseCode = rawExisting;
            for (const imp of incomingImports) {
              if (!baseCode.includes(imp)) {
                baseCode = `${imp}\n${baseCode}`;
              }
            }

            // Recalculate funcPos after injecting imports if any
            const updatedFuncPos = baseCode.search(new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:const|function|class)\\s+${identifier}\\b`));
            const updatedFuncEnd = this.findMatchingClosingBrace(baseCode, updatedFuncPos);

            const before = baseCode.slice(0, updatedFuncPos);
            const after = baseCode.slice(updatedFuncEnd);
            const surgicallyMerged = `${before}${incomingFuncCode}${after}`;
            return {
              success: true,
              finalCode: surgicallyMerged,
              mode: "surgical_function",
              linesBefore: existingLines,
              linesAfter: surgicallyMerged.split("\n").length,
            };
          }
        }
      }

      // Strategy 3C: Catastrophic Truncation Guard
      // If incoming code is tiny compared to existing and no surgical point was found, REJECT OVERWRITE!
      if (existingLines >= 25 && incomingLines < existingLines * 0.45) {
        return {
          success: false,
          finalCode: rawExisting,
          mode: "rejected",
          reason: `Tehlikeli silme engellendi: Önerilen kod (${incomingLines} satır), mevcut dosyadaki (${existingLines} satır) kodların silinmesine yol açacaktı. Orijinal dosya korundu.`,
          linesBefore: existingLines,
          linesAfter: existingLines,
        };
      }
    }

    // Case 4: Full File Replacement with Import Preservation
    if (existingLines >= 30 && incomingLines < existingLines * 0.4) {
      return {
        success: false,
        finalCode: rawExisting,
        mode: "rejected",
        reason: `Tehlikeli silme engellendi: Önerilen kod (${incomingLines} satır), mevcut dosyadaki (${existingLines} satır) kodların silinmesine yol açacaktı. Orijinal dosya korundu.`,
        linesBefore: existingLines,
        linesAfter: existingLines,
      };
    }

    let integratedCode = rawIncoming;
    if (existingLines >= 20 && hasImports) {
      integratedCode = this.preserveMissingImports(rawExisting, rawIncoming);
    }

    return {
      success: true,
      finalCode: integratedCode,
      mode: "full_rewrite",
      linesBefore: existingLines,
      linesAfter: integratedCode.split("\n").length,
    };
  }

  /**
   * Detects lazy placeholder patterns in code (ellipses, comments indicating missing code)
   */
  public static hasPlaceholders(code: string): { found: boolean; match?: string } {
    const placeholderPatterns = [
      /\{\s*\/\*\s*\.{3}.*?\*\/\s*\}/i,               // {/* ... */}
      /\/\/\s*\.{3}/i,                                // // ...
      /\/\*\s*\.{3}.*?\*\//i,                         // /* ... */
      /\/\/\s*.*\b(?:önceki|kalan|diğer|existing|rest of|unchanged)\b.*\b(?:kod|code|state|fonksiyon|implement)/i,
      /\/\/\s*TODO:\s*(?:önceki|kalan|rest|existing)/i,
      /\.\.\.\s*(?:önceki|kalan|diğer|rest of|existing)\s*(?:kodlar|kod|code)/i,
    ];
    for (const pattern of placeholderPatterns) {
      const m = code.match(pattern);
      if (m) {
        return { found: true, match: m[0] };
      }
    }
    return { found: false };
  }

  /**
   * Helper to find matching closing brace of a function or block starting at pos.
   */
  private static findMatchingClosingBrace(text: string, startPos: number): number {
    const firstBrace = text.indexOf("{", startPos);
    if (firstBrace === -1) return -1;

    let depth = 0;
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          // Check for optional trailing semicolon or newline
          let end = i + 1;
          if (text[end] === ";") end++;
          return end;
        }
      }
    }
    return -1;
  }

  /**
   * Ensures that essential imports present in existing code that are still referenced
   * in incoming code's JSX/body are not accidentally wiped out.
   */
  private static preserveMissingImports(existingCode: string, incomingCode: string): string {
    const importRegex = /import\s+.*from\s+["'][^"']+["'];?/g;
    const existingImports = existingCode.match(importRegex) || [];
    const incomingImports = incomingCode.match(importRegex) || [];

    const missingImports: string[] = [];

    for (const extImp of existingImports) {
      // Check identifier in import
      const idMatch = extImp.match(/import\s+(?:([a-zA-Z0-9_$]+)|\{([^}]+)\})/);
      if (idMatch) {
        const id = (idMatch[1] || idMatch[2] || "").trim();
        // If incoming code doesn't import this, but uses it in JSX/code
        if (!incomingImports.some((i) => i.includes(id)) && new RegExp(`\\b${id}\\b`).test(incomingCode)) {
          missingImports.push(extImp);
        }
      }
    }

    if (missingImports.length > 0) {
      return `${missingImports.join("\n")}\n${incomingCode}`;
    }

    return incomingCode;
  }
}
