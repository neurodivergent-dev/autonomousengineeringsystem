import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import {
  Folder,
  FileCode,
  Shield,
  Zap,
  Cpu,
  CheckCircle,
  AlertTriangle,
  Flame,
  Send,
  ChevronRight,
  ChevronDown,
  X,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import "./App.css";

const API_BASE = "http://localhost:5180/api";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface OpenFile {
  path: string;
  content: string;
  isDirty?: boolean;
}

export function App() {
  const [targetRepo, setTargetRepo] = useState("");
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["components", "app"]));
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string>("");
  const [editorContent, setEditorContent] = useState<string>("");

  // Aegis 6-Gate Status
  const [gateResults, setGateResults] = useState<{ [key: string]: boolean }>({
    "TypeScript": true,
    "Blast Radius": true,
    "Theme Tokens": false,
    "Zero-Emoji": false,
    "i18n": true,
    "AST Health": true,
  });

  // Blast Radius State
  const [blastData, setBlastData] = useState<{ risk: "LOW" | "MEDIUM" | "HIGH"; affectedFiles: string[] } | null>(null);

  // Copilot State
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string; plan?: any }>>([
    {
      role: "system",
      content: "MetaFrame Agentic Core online. Ready to plan, verify, and ground code in AST topology.",
    },
  ]);
  const [isWorking, setIsWorking] = useState(false);

  // Fetch initial workspace
  useEffect(() => {
    fetch(`${API_BASE}/workspace`)
      .then((res) => res.json())
      .then((data) => {
        setTargetRepo(data.targetRepo);
        setFileTree(data.tree);
      })
      .catch((err) => console.error("Failed to connect to Bun server:", err));
  }, []);

  // Monaco Editor mount configuration - Custom MetaFrame Cyber theme matching Mindbook Pro
  const handleEditorWillMount = (monaco: any) => {
    // 1. Define custom deep obsidian & neon cyber theme
    monaco.editor.defineTheme("metaframe-cyber", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: "E2E8F0", background: "090A0F" },
        { token: "comment", foreground: "64748B", fontStyle: "italic" },
        { token: "keyword", foreground: "C084FC", fontStyle: "bold" }, // Neon Violet
        { token: "keyword.control", foreground: "F472B6", fontStyle: "bold" }, // Pink-400
        { token: "string", foreground: "34D399" }, // Emerald-400
        { token: "number", foreground: "FBBF24" }, // Amber-400
        { token: "type", foreground: "818CF8" }, // Indigo-400
        { token: "class", foreground: "A78BFA" }, // Violet-400
        { token: "function", foreground: "38BDF8" }, // Sky-400
        { token: "variable", foreground: "F1F5F9" },
        { token: "variable.parameter", foreground: "E2E8F0" },
        { token: "tag", foreground: "F472B6", fontStyle: "bold" }, // JSX tags (<View, <Text)
        { token: "tag.id", foreground: "38BDF8" },
        { token: "attribute.name", foreground: "38BDF8" }, // JSX props (style, onPress)
        { token: "attribute.value", foreground: "34D399" },
        { token: "delimiter", foreground: "94A3B8" },
      ],
      colors: {
        "editor.background": "#090A0F", // Deep OLED Obsidian
        "editor.foreground": "#E2E8F0",
        "editorLineNumber.foreground": "#334155",
        "editorLineNumber.activeForeground": "#A855F7", // Neon violet active line number
        "editorCursor.foreground": "#C084FC",
        "editor.lineHighlightBackground": "#12151F",
        "editor.selectionBackground": "#3B076477", // Velvet purple glow
        "editor.inactiveSelectionBackground": "#1E1B4B55",
        "editorGutter.background": "#090A0F",
        "minimap.background": "#090A0F",
        "scrollbarSlider.background": "#1E293B60",
        "scrollbarSlider.hoverBackground": "#7C3AED80",
        "scrollbarSlider.activeBackground": "#7C3AEDCC",
        "editorWidget.background": "#12151F",
        "editorWidget.border": "#262C40",
      },
    });

    // 2. Set the active theme
    monaco.editor.setTheme("metaframe-cyber");

    // 3. Disable missing node_modules false-positives
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.Latest,
      allowNonTextFiles: true,
      allowJs: true,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
    });
  };

  // Open file in editor
  const handleOpenFile = async (relPath: string) => {
    const existing = openFiles.find((f) => f.path === relPath);
    if (existing) {
      setActiveFilePath(existing.path);
      setEditorContent(existing.content);
      fetchBlastRadius(relPath);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/file?path=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        const newFile = { path: relPath, content: data.content };
        setOpenFiles((prev) => [...prev, newFile]);
        setActiveFilePath(relPath);
        setEditorContent(data.content);
        fetchBlastRadius(relPath);
      }
    } catch (e) {
      console.error("Open file error:", e);
    }
  };

  // Close tab
  const handleCloseTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const filtered = openFiles.filter((f) => f.path !== path);
    setOpenFiles(filtered);
    if (activeFilePath === path) {
      if (filtered.length > 0) {
        setActiveFilePath(filtered[filtered.length - 1].path);
        setEditorContent(filtered[filtered.length - 1].content);
        fetchBlastRadius(filtered[filtered.length - 1].path);
      } else {
        setActiveFilePath("");
        setEditorContent("");
        setBlastData(null);
      }
    }
  };

  // Save File (Ctrl+S or Action)
  const handleSaveFile = async () => {
    if (!activeFilePath) return;
    try {
      const res = await fetch(`${API_BASE}/file?path=${encodeURIComponent(activeFilePath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editorContent }),
      });
      const data = await res.json();
      if (data.success) {
        setOpenFiles((prev) =>
          prev.map((f) => (f.path === activeFilePath ? { ...f, content: editorContent, isDirty: false } : f))
        );
        if (data.gateResult) {
          updateGateStatus(data.gateResult.gates);
        }
      }
    } catch (e) {
      console.error("Save file error:", e);
    }
  };

  // Fetch Blast Radius for active file
  const fetchBlastRadius = async (path: string) => {
    try {
      const res = await fetch(`${API_BASE}/ast/impact?file=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.impact) {
        setBlastData(data.impact);
      }
    } catch {
      setBlastData(null);
    }
  };

  // Run AST Indexer
  const handleRunIndex = async () => {
    setIsWorking(true);
    try {
      const res = await fetch(`${API_BASE}/ast/index`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert(
          `AST Knowledge Graph Re-Indexed!\nNodes (Files): ${data.result.nodeCount}\nEdges: ${data.result.edgeCount}\nElapsed: ${data.result.durationMs}ms`
        );
      }
    } catch (e: any) {
      alert("Indexing error: " + e.message);
    } finally {
      setIsWorking(false);
    }
  };

  // Run 6-Gate Full Verification
  const handleRunVerify = async () => {
    setIsWorking(true);
    try {
      const res = await fetch(`${API_BASE}/gates/verify${activeFilePath ? `?file=${encodeURIComponent(activeFilePath)}` : ""}`);
      const data = await res.json();
      if (data.report) {
        updateGateStatus(data.report.gates);
      }
    } catch (e: any) {
      console.error("Verify error:", e);
    } finally {
      setIsWorking(false);
    }
  };

  const updateGateStatus = (gates: any[]) => {
    const map: { [key: string]: boolean } = {};
    gates.forEach((g) => {
      if (g.gateName.includes("TypeScript")) map["TypeScript"] = g.passed;
      if (g.gateName.includes("Blast Radius")) map["Blast Radius"] = g.passed;
      if (g.gateName.includes("Theme")) map["Theme Tokens"] = g.passed;
      if (g.gateName.includes("Emoji")) map["Zero-Emoji"] = g.passed;
      if (g.gateName.includes("i18n")) map["i18n"] = g.passed;
      if (g.gateName.includes("Code Health")) map["AST Health"] = g.passed;
    });
    setGateResults((prev) => ({ ...prev, ...map }));
  };

  // Handle Copilot Plan Execution
  const handleCopilotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!copilotPrompt.trim() || isWorking) return;

    const userPrompt = copilotPrompt;
    setCopilotPrompt("");
    setChatMessages((prev) => [...prev, { role: "user", content: userPrompt }]);
    setIsWorking(true);

    try {
      const res = await fetch(`${API_BASE}/orchestrate/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userPrompt,
          candidateFiles: activeFilePath ? [activeFilePath] : [],
        }),
      });
      const data = await res.json();
      if (data.result) {
        const r = data.result;
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `**${r.prd.title}** (${r.prd.id})\n\n**ADR:** ${r.adr.id} (Risk: ${r.adr.blastRadiusRisk})\n\n**Plan Steps (${r.plan.steps.length}):**\n` +
              r.plan.steps.map((s: any, idx: number) => `${idx + 1}. \`${s.filePath}\` - ${s.description}`).join("\n"),
            plan: r.plan,
          },
        ]);
        if (r.verificationReport) {
          updateGateStatus(r.verificationReport.gates);
        }
      }
    } catch (err: any) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Error executing workflow: ${err.message}` }]);
    } finally {
      setIsWorking(false);
    }
  };

  // Toggle folder
  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  // Render tree node
  const renderTreeNode = (node: FileNode, level = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    if (node.isDirectory) {
      return (
        <div key={node.path}>
          <div
            className="tree-node"
            style={{ paddingLeft: `${level * 12 + 6}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={14} color="#8b5cf6" />
            <span>{node.name}</span>
          </div>
          {isExpanded && node.children && node.children.map((child) => renderTreeNode(child, level + 1))}
        </div>
      );
    }

    const isActive = activeFilePath === node.path;
    return (
      <div
        key={node.path}
        className={`tree-node ${isActive ? "active" : ""}`}
        style={{ paddingLeft: `${level * 12 + 18}px` }}
        onClick={() => handleOpenFile(node.path)}
      >
        <FileCode size={13} color={node.name.endsWith(".tsx") ? "#38bdf8" : "#94a3b8"} />
        <span>{node.name}</span>
      </div>
    );
  };

  return (
    <div className="studio-container">
      {/* ── Top Header / Aegis HUD ── */}
      <header className="top-hud">
        <div className="brand-section">
          <div className="brand-logo">
            <Cpu size={18} />
            <span>METAFRAME</span>
          </div>
          <span className="badge-tag">STUDIO</span>
          <div className="workspace-pill" title={targetRepo}>
            <Folder size={12} />
            <span>{targetRepo.split(/[\\/]/).pop()}</span>
          </div>
        </div>

        {/* 6-Gate Status Pills */}
        <div className="gates-hud">
          {Object.entries(gateResults).map(([gateName, passed]) => (
            <div
              key={gateName}
              className={`gate-chip ${passed ? "pass" : "fail"}`}
              onClick={handleRunVerify}
              title={`Gate: ${gateName} (${passed ? "PASS" : "FAIL"})`}
            >
              {passed ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
              <span>{gateName}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="hud-actions">
          <button className="btn-hud" onClick={handleRunIndex} disabled={isWorking} title="Re-Index AST Knowledge Graph">
            <Zap size={13} color="#f59e0b" />
            <span>Index AST</span>
          </button>
          <button className="btn-hud primary" onClick={handleRunVerify} disabled={isWorking}>
            <Shield size={13} />
            <span>Verify (6-Gate)</span>
          </button>
        </div>
      </header>

      {/* ── Main Workspace ── */}
      <div className="main-workspace">
        {/* Left Sidebar: File Tree & Radar */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span>Explorer</span>
            <span style={{ fontSize: "10px", color: "var(--accent)" }}>AST Live</span>
          </div>
          <div className="file-tree">{fileTree.map((node) => renderTreeNode(node))}</div>

          {/* Blast Radius Radar for active file */}
          {blastData && (
            <div className="radar-card">
              <div className="radar-title">
                <Flame size={13} color="#f59e0b" />
                <span>Blast Radius Radar</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>Risk Rating:</span>
                <span className={`risk-badge ${blastData.risk}`}>{blastData.risk}</span>
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                Direct / Transitive Dependents: <strong>{blastData.affectedFiles.length}</strong>
              </div>
              <div style={{ maxHeight: "80px", overflowY: "auto", marginTop: "4px" }}>
                {blastData.affectedFiles.map((f) => (
                  <div key={f} style={{ fontSize: "10px", color: "var(--text-muted)", padding: "2px 0" }}>
                    • {f}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Center: Monaco Code Editor */}
        <main className="editor-panel">
          <div className="editor-tabs">
            {openFiles.map((tab) => (
              <div
                key={tab.path}
                className={`editor-tab ${activeFilePath === tab.path ? "active" : ""}`}
                onClick={() => {
                  setActiveFilePath(tab.path);
                  setEditorContent(tab.content);
                  fetchBlastRadius(tab.path);
                }}
              >
                <span>{tab.path.split("/").pop()}</span>
                {tab.isDirty && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />}
                <span className="tab-close" onClick={(e) => handleCloseTab(e, tab.path)}>
                  <X size={12} />
                </span>
              </div>
            ))}
          </div>

          <div className="editor-wrapper">
            {activeFilePath ? (
              <Editor
                height="100%"
                theme="metaframe-cyber"
                path={activeFilePath}
                value={editorContent}
                beforeMount={handleEditorWillMount}
                onChange={(val) => {
                  setEditorContent(val || "");
                  setOpenFiles((prev) =>
                    prev.map((f) => (f.path === activeFilePath ? { ...f, content: val || "", isDirty: true } : f))
                  );
                }}
                options={{
                  fontFamily: "'JetBrains Mono', Consolas, monospace",
                  fontSize: 13,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  automaticLayout: true,
                }}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  gap: 12,
                }}
              >
                <Cpu size={48} strokeWidth={1} color="var(--accent)" />
                <p>Select a file from the explorer or create a plan to begin.</p>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Press <kbd>Ctrl+S</kbd> to save and run deterministic gates.
                </span>
              </div>
            )}
          </div>

          {activeFilePath && (
            <footer className="editor-footer">
              <div>{activeFilePath}</div>
              <div style={{ display: "flex", gap: "16px" }}>
                <span>UTF-8</span>
                <span>{activeFilePath.endsWith(".tsx") ? "TypeScript React" : "TypeScript"}</span>
                <span style={{ cursor: "pointer", color: "var(--accent)" }} onClick={handleSaveFile}>
                  Save & Test (Ctrl+S)
                </span>
              </div>
            </footer>
          )}
        </main>

        {/* Right: MetaFrame Agent Copilot */}
        <aside className="copilot-panel">
          <div className="copilot-header">
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <Sparkles size={16} color="var(--accent)" />
              <span>Orchestrator Copilot</span>
            </div>
            <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>AST-Grounded</span>
          </div>

          <div className="copilot-body">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`agent-bubble ${msg.role}`}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>
                  {msg.role === "user" ? "YOU" : "METAFRAME AGENTS (Orion · Daedalus · Vulcan)"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
              </div>
            ))}
            {isWorking && (
              <div className="agent-bubble system" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <RotateCcw size={14} className="spin" />
                <span>Generating PRD, evaluating blast radius & formulating plan...</span>
              </div>
            )}
          </div>

          <form className="copilot-input-container" onSubmit={handleCopilotSubmit}>
            <textarea
              className="copilot-textarea"
              placeholder="Ask MetaFrame to plan a feature or refactor with AST grounding..."
              value={copilotPrompt}
              onChange={(e) => setCopilotPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCopilotSubmit(e);
                }
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>Enter to Send · Shift+Enter for newline</span>
              <button
                type="submit"
                className="btn-hud primary"
                style={{ padding: "4px 10px" }}
                disabled={!copilotPrompt.trim() || isWorking}
              >
                <Send size={12} />
                <span>Execute</span>
              </button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}

export default App;
