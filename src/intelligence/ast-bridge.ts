import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve, relative } from "path";
import { execSync } from "child_process";
import { ASTIndexer, type IndexResult } from "./indexer";
import type { ASTFileCard } from "../types";

export class ASTBridge {
  private repoRoot: string;
  private systemRoot: string;
  private graphPath: string;
  private scriptsDir: string;
  private cachedGraph: any = null;

  constructor(repoRoot: string = process.cwd(), systemRoot?: string) {
    this.repoRoot = resolve(repoRoot);
    this.systemRoot = systemRoot ? resolve(systemRoot) : resolve(__dirname, "../..");
    this.graphPath = join(this.repoRoot, "ai-reports", "knowledge_graph.json");
    this.scriptsDir = join(this.systemRoot, "repo-intelligence-layer", "scripts");
  }

  /**
   * Generates or refreshes the AST Knowledge Graph for the target repo.
   */
  public indexGraph(options?: { onProgress?: (file: string, current: number, total: number) => void }): IndexResult {
    const indexer = new ASTIndexer(this.repoRoot);
    const result = indexer.generate(options);
    this.cachedGraph = null; // Invalidate memory cache
    return result;
  }

  /**
   * Ensures the knowledge graph exists, generating it if absent.
   */
  public ensureKnowledgeGraph(): void {
    if (!this.hasKnowledgeGraph()) {
      this.indexGraph();
    }
  }

  /**
   * Checks if the pre-computed AST knowledge graph exists.
   */
  public hasKnowledgeGraph(): boolean {
    return existsSync(this.graphPath);
  }

  /**
   * Loads the knowledge graph into memory (cached).
   */
  public getKnowledgeGraph(): any {
    if (this.cachedGraph) return this.cachedGraph;
    if (!this.hasKnowledgeGraph()) {
      return null;
    }
    try {
      const raw = readFileSync(this.graphPath, "utf-8");
      this.cachedGraph = JSON.parse(raw);
      return this.cachedGraph;
    } catch {
      return null;
    }
  }

  /**
   * Executes a command on repo-intelligence-layer/scripts/depencies.js
   */
  public queryTool(subcommand: string, arg: string = ""): string {
    const scriptPath = join(this.scriptsDir, "depencies.js");
    if (!existsSync(scriptPath)) {
      return `[ASTBridge] Script not found: ${scriptPath}`;
    }
    try {
      const cmd = `node "${scriptPath}" ${subcommand} "${arg}"`;
      return execSync(cmd, {
        cwd: this.repoRoot,
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, TARGET_REPO: this.repoRoot },
      }).trim();
    } catch (err: any) {
      return (err.stdout || err.stderr || err.message || "").toString().trim();
    }
  }

  /**
   * Returns an identity card for a file or extracts summary info
   */
  public getFileCard(filePath: string): ASTFileCard {
    const rawOutput = this.queryTool("file", filePath);
    const depsOutput = this.queryTool("deps", filePath);
    const dependentsOutput = this.queryTool("dependents", filePath);

    const deps = depsOutput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("Depend") && !l.startsWith("Files"));
    const dependents = dependentsOutput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("Depend") && !l.startsWith("Files"));

    return {
      filePath,
      role: "Component",
      exports: [],
      callers: [],
      dependencies: deps,
      dependents: dependents,
      risk: dependents.length > 5 ? "HIGH" : dependents.length > 2 ? "MEDIUM" : "LOW",
    };
  }

  /**
   * Gets caller references for a specific function/hook/identifier
   */
  public getCallers(functionName: string): string[] {
    const out = this.queryTool("callers", functionName);
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.includes("Searching") && !l.startsWith("No callers"));
  }

  /**
   * Gets JSX render sites for a component
   */
  public getRenderSites(componentName: string): string[] {
    const out = this.queryTool("where", componentName);
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.includes("Searching"));
  }

  /**
   * Computes transitive blast radius for a file path
   */
  public getImpact(filePath: string): { risk: "LOW" | "MEDIUM" | "HIGH"; affectedFiles: string[] } {
    const out = this.queryTool("impact", filePath);
    const lines = out.split("\n").map((l) => l.trim());
    const affectedFiles: string[] = [];
    let risk: "LOW" | "MEDIUM" | "HIGH" = "LOW";

    let inFileList = false;
    for (const l of lines) {
      if (l.includes("HIGH RISK") || l.includes("YUKSEK") || l.includes("Risk: HIGH")) risk = "HIGH";
      else if (l.includes("MEDIUM RISK") || l.includes("ORTA") || l.includes("Risk: MEDIUM")) risk = "MEDIUM";

      if (l.startsWith("Sebep:")) {
        inFileList = true;
        continue;
      }

      if (inFileList) {
        if (/\.(tsx?|jsx?)/.test(l)) {
          const cleanFile = l.split(/\s+/)[0];
          if (cleanFile && !affectedFiles.includes(cleanFile)) {
            affectedFiles.push(cleanFile);
          }
        }
      } else if (l.startsWith("-") || l.startsWith("•") || l.startsWith("->")) {
        affectedFiles.push(l.replace(/^[-•>]\s*/, "").trim());
      }
    }

    return { risk, affectedFiles };
  }

  /**
   * Navigation route tree and map
   */
  public getRoutes(): string {
    const scriptPath = join(this.scriptsDir, "route-navigator.js");
    if (!existsSync(scriptPath)) return "route-navigator.js not found";
    try {
      return execSync(`node "${scriptPath}" tree`, {
        cwd: this.repoRoot,
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, TARGET_REPO: this.repoRoot },
      }).trim();
    } catch (e: any) {
      return e.message || "Failed to query routes";
    }
  }

  /**
   * Supabase tables and RPC catalog
   */
  public getSupabaseOverview(): string {
    const scriptPath = join(this.scriptsDir, "supabase-mapper.js");
    if (!existsSync(scriptPath)) return "supabase-mapper.js not found";
    try {
      return execSync(`node "${scriptPath}" map`, {
        cwd: this.repoRoot,
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, TARGET_REPO: this.repoRoot },
      }).trim();
    } catch (e: any) {
      return e.message || "Failed to query supabase map";
    }
  }

  /**
   * Returns a clean list of existing source files (relative paths) in the repository.
   */
  public getSourceFiles(): string[] {
    const srcDir = join(this.repoRoot, "src");
    if (!existsSync(srcDir)) return [];

    const files: string[] = [];
    const walk = (dir: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = join(dir, ent.name);
          if (ent.isDirectory()) {
            if (ent.name !== "node_modules" && ent.name !== ".git" && ent.name !== "dist") {
              walk(full);
            }
          } else if (/\.(tsx?|jsx?|css)$/.test(ent.name)) {
            files.push(relative(this.repoRoot, full).replace(/\\/g, "/"));
          }
        }
      } catch {}
    };

    walk(srcDir);
    return files.sort();
  }
}
