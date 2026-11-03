import ts from "typescript";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve, dirname, basename, extname } from "path";

export interface ASTObjective {
  language: string;
  lines: number;
  jsx: boolean;
  imports: number;
  exports: number;
  functions: number;
  hooks: number;
  components: number;
  framework: string;
  isRoute: boolean;
  isLayout: boolean;
  isDynamic: boolean;
  route: string | null;
}

export interface ASTSemantic {
  purpose: string;
}

export interface ASTGraphData {
  dependencies: string[];
  calls: string[];
  renders: string[];
}

export interface ASTEntity {
  name: string;
  type: "function" | "component" | "hook" | "class" | "type" | "const";
  async: boolean;
  exported: boolean;
}

export interface ASTKnowledgeNode {
  file: string;
  objective: ASTObjective;
  semantic: ASTSemantic;
  graph: ASTGraphData;
  entities: ASTEntity[];
  importedBy?: string[];
}

export interface ASTKnowledgeGraph {
  generatedAt: number;
  nodes: Record<string, ASTKnowledgeNode>;
}

export interface IndexResult {
  generatedAt: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
  outputPath: string;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".expo",
  ".next",
  "dist",
  "build",
  "ai-reports",
  ".metaframe",
  ".husky",
  "coverage",
  "android",
  "ios",
  ".agents",
  ".system_generated",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export class ASTIndexer {
  private repoRoot: string;
  private outputPath: string;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = resolve(repoRoot);
    this.outputPath = join(this.repoRoot, "ai-reports", "knowledge_graph.json");
  }

  /**
   * Recursively scans and collects all JS/TS source files in repoRoot.
   */
  public scanFiles(): string[] {
    const files: string[] = [];

    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const full = join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
          const rel = relative(this.repoRoot, full).replace(/\\/g, "/");
          files.push(rel);
        }
      }
    };

    walk(this.repoRoot);
    return files.sort();
  }

  /**
   * Resolves an import specifier to a relative file path inside the repo if possible.
   */
  private resolveImport(importSpec: string, currentFileRel: string, fileSet: Set<string>): string {
    // 1. Relative import (./ or ../)
    if (importSpec.startsWith(".")) {
      const currentDir = dirname(join(this.repoRoot, currentFileRel));
      const targetAbs = resolve(currentDir, importSpec);
      const targetRel = relative(this.repoRoot, targetAbs).replace(/\\/g, "/");

      // Check exact match or with extensions
      const candidates = [
        targetRel,
        `${targetRel}.ts`,
        `${targetRel}.tsx`,
        `${targetRel}.js`,
        `${targetRel}.jsx`,
        `${targetRel}/index.ts`,
        `${targetRel}/index.tsx`,
        `${targetRel}/index.js`,
        `${targetRel}/index.jsx`,
      ];

      for (const cand of candidates) {
        if (fileSet.has(cand)) return cand;
      }
      return targetRel;
    }

    // 2. Alias import (@/ or ~/)
    if (importSpec.startsWith("@/") || importSpec.startsWith("~/")) {
      const stripped = importSpec.slice(2);
      const candidates = [
        stripped,
        `${stripped}.ts`,
        `${stripped}.tsx`,
        `${stripped}.js`,
        `${stripped}.jsx`,
        `${stripped}/index.ts`,
        `${stripped}/index.tsx`,
        join("src", stripped).replace(/\\/g, "/"),
        join("src", `${stripped}.ts`).replace(/\\/g, "/"),
        join("src", `${stripped}.tsx`).replace(/\\/g, "/"),
      ];

      for (const cand of candidates) {
        if (fileSet.has(cand)) return cand;
      }
    }

    // 3. External package (e.g. "react", "expo-router", "@supabase/supabase-js")
    return importSpec;
  }

  /**
   * Analyzes a single file's AST and extracts its metadata, calls, renders, and entities.
   */
  private analyzeFile(
    fileRel: string,
    fileSet: Set<string>
  ): { node: ASTKnowledgeNode; resolvedDeps: string[] } | null {
    const absPath = join(this.repoRoot, fileRel);
    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      return null;
    }

    const ext = extname(fileRel).toLowerCase();
    const isTs = ext === ".ts" || ext === ".tsx";
    const isJsx = ext === ".tsx" || ext === ".jsx";

    const scriptKind =
      ext === ".tsx"
        ? ts.ScriptKind.TSX
        : ext === ".ts"
        ? ts.ScriptKind.TS
        : ext === ".jsx"
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;

    const sourceFile = ts.createSourceFile(
      fileRel,
      content,
      ts.ScriptTarget.Latest,
      true, // setParentNodes
      scriptKind
    );

    const dependencies: string[] = [];
    const callsSet = new Set<string>();
    const rendersSet = new Set<string>();
    const entities: ASTEntity[] = [];

    let exportCount = 0;
    let functionCount = 0;
    let hookCount = 0;
    let componentCount = 0;

    // Detect imports
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        const spec = (statement.moduleSpecifier as ts.StringLiteral).text;
        dependencies.push(spec);
      } else if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
        exportCount++;
      }
    }

    // Recursive AST visitor
    const visit = (node: ts.Node) => {
      // 1. Function Declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text;
        const isAsync = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
        const isExported = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

        if (name.startsWith("use") && name.length > 3 && name[3] === name[3].toUpperCase()) {
          hookCount++;
          entities.push({ name, type: "hook", async: isAsync, exported: isExported });
        } else if (name[0] === name[0].toUpperCase() && !name.startsWith("_") && isJsx) {
          componentCount++;
          entities.push({ name, type: "component", async: isAsync, exported: isExported });
        } else {
          functionCount++;
          entities.push({ name, type: "function", async: isAsync, exported: isExported });
        }
        if (isExported) exportCount++;
      }

      // 2. Variable Statements (const Foo = () => {}, const useBar = () => {})
      if (ts.isVariableStatement(node)) {
        const isExported = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer) {
            const name = decl.name.text;
            const init = decl.initializer;

            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
              const isAsync = !!init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

              if (name.startsWith("use") && name.length > 3 && name[3] === name[3].toUpperCase()) {
                hookCount++;
                entities.push({ name, type: "hook", async: isAsync, exported: isExported });
              } else if (name[0] === name[0].toUpperCase() && isJsx) {
                componentCount++;
                entities.push({ name, type: "component", async: isAsync, exported: isExported });
              } else {
                functionCount++;
                entities.push({ name, type: "function", async: isAsync, exported: isExported });
              }
              if (isExported) exportCount++;
            }
          }
        }
      }

      // 3. Class Declarations
      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text;
        const isExported = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        entities.push({ name, type: "class", async: false, exported: isExported });
        if (isExported) exportCount++;
      }

      // 4. Calls
      if (ts.isCallExpression(node)) {
        // e.g. require("...")
        if (ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length > 0) {
          const arg = node.arguments[0];
          if (ts.isStringLiteral(arg)) {
            dependencies.push(arg.text);
          }
        }

        // Call name: identifier or property access
        if (ts.isIdentifier(node.expression)) {
          callsSet.add(node.expression.text);
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          callsSet.add(node.expression.name.text);
        }
      }

      // 5. JSX Renders
      if (ts.isJsxElement(node)) {
        const tagName = node.openingElement.tagName.getText(sourceFile);
        rendersSet.add(tagName);
      } else if (ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        rendersSet.add(tagName);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Resolve dependencies
    const resolvedDeps = dependencies.map((dep) => this.resolveImport(dep, fileRel, fileSet));

    // Framework detection
    let framework = "TypeScript";
    if (dependencies.some((d) => d === "react-native" || d.startsWith("expo"))) {
      framework = "React Native";
    } else if (dependencies.some((d) => d === "react" || d === "react-dom")) {
      framework = "React";
    } else if (dependencies.some((d) => d === "next")) {
      framework = "Next.js";
    } else if (dependencies.some((d) => d === "vue")) {
      framework = "Vue";
    }

    // Route detection
    const isRoute =
      fileRel.startsWith("app/") ||
      fileRel.startsWith("src/app/") ||
      fileRel.startsWith("pages/") ||
      fileRel.startsWith("src/pages/") ||
      fileRel.includes("/screens/");

    const fileBase = basename(fileRel);
    const isLayout = fileBase.startsWith("_layout") || fileBase.startsWith("layout");
    const isDynamic = fileBase.includes("[") || fileBase.includes("$");

    let route: string | null = null;
    if (isRoute && !isLayout) {
      route = "/" + fileRel.replace(/^(app|src\/app|pages|src\/pages)\//, "").replace(/\.(tsx|ts|jsx|js)$/, "");
      if (route.endsWith("/index")) route = route.slice(0, -6) || "/";
    }

    const lines = content.split("\n").length;

    // Objective
    const objective: ASTObjective = {
      language: ext === ".tsx" ? "TypeScript (TSX)" : ext === ".ts" ? "TypeScript (TS)" : ext === ".jsx" ? "JavaScript (JSX)" : "JavaScript",
      lines,
      jsx: rendersSet.size > 0 || isJsx,
      imports: dependencies.length,
      exports: exportCount,
      functions: functionCount,
      hooks: hookCount,
      components: componentCount,
      framework,
      isRoute,
      isLayout,
      isDynamic,
      route,
    };

    // Semantic purpose
    const mainEntities = entities.map((e) => e.name).slice(0, 3).join(", ");
    const mainDeps = dependencies.slice(0, 3).join(", ");
    let purpose = "";
    if (componentCount > 0) {
      purpose = `${mainEntities || fileBase} arayüz bileşenini (${framework}) render eden UI modülü.`;
    } else if (hookCount > 0) {
      purpose = `${mainEntities || fileBase} özel hook mantığını barındıran durum yönetim modülü.`;
    } else if (isRoute) {
      purpose = `${route || fileRel} ekranı ve navigasyon rotası.`;
    } else {
      purpose = `${mainDeps ? mainDeps + " kullanarak " : ""}${mainEntities || fileBase} iş mantığını yöneten modül.`;
    }

    const node: ASTKnowledgeNode = {
      file: fileRel,
      objective,
      semantic: { purpose },
      graph: {
        dependencies: resolvedDeps,
        calls: Array.from(callsSet).slice(0, 100),
        renders: Array.from(rendersSet).slice(0, 50),
      },
      entities,
      importedBy: [],
    };

    return { node, resolvedDeps };
  }

  /**
   * Generates the entire AST Knowledge Graph, calculates reverse importedBy links,
   * and writes the output JSON file to ai-reports/knowledge_graph.json.
   */
  public generate(options: { onProgress?: (file: string, current: number, total: number) => void } = {}): IndexResult {
    const start = Date.now();
    const files = this.scanFiles();
    const fileSet = new Set(files);

    const nodes: Record<string, ASTKnowledgeNode> = {};
    const dependencyMap = new Map<string, string[]>();

    // Step 1: Parse and analyze each file
    files.forEach((file, idx) => {
      options.onProgress?.(file, idx + 1, files.length);
      const res = this.analyzeFile(file, fileSet);
      if (res) {
        nodes[file] = res.node;
        dependencyMap.set(file, res.resolvedDeps);
      }
    });

    // Step 2: Compute reverse dependencies (importedBy)
    let edgeCount = 0;
    dependencyMap.forEach((deps, importer) => {
      for (const dep of deps) {
        // If dep matches a file node in our repository
        if (nodes[dep]) {
          if (!nodes[dep].importedBy) nodes[dep].importedBy = [];
          if (!nodes[dep].importedBy!.includes(importer)) {
            nodes[dep].importedBy!.push(importer);
            edgeCount++;
          }
        }
      }
    });

    // Step 3: Write out knowledge_graph.json
    const graph: ASTKnowledgeGraph = {
      generatedAt: Date.now(),
      nodes,
    };

    const outDir = dirname(this.outputPath);
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }

    writeFileSync(this.outputPath, JSON.stringify(graph, null, 2), "utf-8");
    const durationMs = Date.now() - start;

    return {
      generatedAt: graph.generatedAt,
      nodeCount: Object.keys(nodes).length,
      edgeCount,
      durationMs,
      outputPath: this.outputPath,
    };
  }
}
