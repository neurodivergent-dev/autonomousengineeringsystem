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
  Sparkles,
  Layers,
  FileText,
  Clock,
  Activity,
  RotateCcw,
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

interface ActivityLog {
  time: string;
  agent: "System" | "Orion" | "Daedalus" | "Vulcan" | "Gemma" | "Aegis" | "AST" | "Healer";
  text: string;
}

interface ActiveWorkflow {
  prompt: string;
  currentPhase: number;
  phaseMessage: string;
  status: "idle" | "running" | "completed" | "error";
  topologyRoutes?: string[];
  prd?: any;
  adr?: any;
  plan?: any;
  execution?: any;
  currentCodeStep?: {
    targetFile: string;
    index: number;
    total: number;
  };
  streamingCode?: string;
  agentTokens?: { [agent: string]: string };
  tokenCount?: number;
  selfHeal?: { active: boolean; message?: string; failingGates?: string[] };
  gates: any[];
  logs: ActivityLog[];
  error?: string;
}

export function App() {
  const [targetRepo, setTargetRepo] = useState("");
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["components", "app"]));
  const [openFiles, setOpenFiles] = useState<OpenFile[]>(() => {
    try {
      const saved = localStorage.getItem("metaframe_open_files");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [activeFilePath, setActiveFilePath] = useState<string>(() => {
    try {
      return localStorage.getItem("metaframe_active_file") || "";
    } catch {}
    return "";
  });
  const [editorContent, setEditorContent] = useState<string>("");
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([1, 2, 3, 4, 5, 6]));

  const toggleStepExpand = (stepNum: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepNum)) next.delete(stepNum);
      else next.add(stepNum);
      return next;
    });
  };

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
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string; plan?: any }>>(() => {
    try {
      const saved = localStorage.getItem("metaframe_chat_messages");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        role: "system",
        content: "MetaFrame Agentic Core online. Ready to plan, verify, and ground code in AST topology.",
      },
    ];
  });
  const [isWorking, setIsWorking] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<ActiveWorkflow | null>(() => {
    try {
      const saved = localStorage.getItem("metaframe_active_workflow");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.status === "running") parsed.status = "completed";
        return parsed;
      }
    } catch {}
    return null;
  });
  const [autoCodeWrite, setAutoCodeWrite] = useState(true);

  // Session Reset Handler
  const handleResetSession = () => {
    if (confirm("Reset current workflow and session history?")) {
      setActiveWorkflow(null);
      localStorage.removeItem("metaframe_active_workflow");
      setChatMessages([
        {
          role: "system",
          content: "MetaFrame Agentic Core online. Ready to plan, verify, and ground code in AST topology.",
        },
      ]);
      localStorage.removeItem("metaframe_chat_messages");
    }
  };

  // Sync state to localStorage
  useEffect(() => {
    try {
      if (activeWorkflow) {
        localStorage.setItem("metaframe_active_workflow", JSON.stringify(activeWorkflow));
      } else {
        localStorage.removeItem("metaframe_active_workflow");
      }
    } catch {}
  }, [activeWorkflow]);

  useEffect(() => {
    try {
      localStorage.setItem("metaframe_chat_messages", JSON.stringify(chatMessages));
    } catch {}
  }, [chatMessages]);

  useEffect(() => {
    try {
      localStorage.setItem("metaframe_open_files", JSON.stringify(openFiles));
      localStorage.setItem("metaframe_active_file", activeFilePath);
    } catch {}
  }, [openFiles, activeFilePath]);

  // Restore editor content if activeFilePath is present on mount
  useEffect(() => {
    if (activeFilePath && !editorContent) {
      fetch(`${API_BASE}/file?path=${encodeURIComponent(activeFilePath)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.content !== undefined) setEditorContent(d.content);
        })
        .catch(() => {});
      fetchBlastRadius(activeFilePath);
    }
  }, []);

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

    // 3. Disable missing node_modules false-positives & syntax validation squiggles
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      diagnosticCodesToIgnore: [2307, 2304, 2552, 2686, 7016, 8010],
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      diagnosticCodesToIgnore: [2307, 2304, 2552, 2686, 7016, 8010],
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

  // Handle Copilot Plan Execution with Real-Time SSE Stream
  const handleCopilotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!copilotPrompt.trim() || isWorking) return;

    const userPrompt = copilotPrompt;
    setCopilotPrompt("");
    setChatMessages((prev) => [...prev, { role: "user", content: userPrompt }]);
    setIsWorking(true);

    const initialWorkflow: ActiveWorkflow = {
      prompt: userPrompt,
      currentPhase: 1,
      phaseMessage: "Navigating AST Topology & Mapping Dependency Edges...",
      status: "running",
      gates: [],
      logs: [
        {
          time: new Date().toTimeString().slice(0, 8),
          agent: "System",
          text: `Workflow initialized for "${userPrompt}"`,
        },
      ],
    };
    setActiveWorkflow(initialWorkflow);

    try {
      const streamUrl = `${API_BASE}/orchestrate/stream?prompt=${encodeURIComponent(
        userPrompt
      )}&files=${encodeURIComponent(activeFilePath || "")}&execute=${autoCodeWrite}`;

      const eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const now = new Date().toTimeString().slice(0, 8);

          if (data.type === "start") {
            setActiveWorkflow((prev) =>
              prev ? { ...prev, logs: [...prev.logs, { time: now, agent: "System", text: `Pipeline engaging for target feature.` }] } : null
            );
          } else if (data.type === "phase") {
            const agentName =
              data.phase === 1
                ? "AST"
                : data.phase === 2
                ? "Orion"
                : data.phase === 3
                ? "Daedalus"
                : data.phase === 4
                ? "Vulcan"
                : data.phase === 5
                ? "Gemma"
                : "Aegis";
            setExpandedSteps((prev) => new Set([...prev, data.phase]));
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    currentPhase: data.phase,
                    phaseMessage: data.message,
                    logs: [
                      ...prev.logs,
                      { time: now, agent: agentName as any, text: data.message },
                    ],
                  }
                : null
            );
          } else if (data.type === "agent_activity") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: data.agent,
                        text: data.text,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "agent_token") {
            setActiveWorkflow((prev) => {
              if (!prev) return null;
              const currentTokens = { ...(prev.agentTokens || {}) };
              currentTokens[data.agent] = (currentTokens[data.agent] || "") + data.token;
              return {
                ...prev,
                agentTokens: currentTokens,
                tokenCount: (prev.tokenCount || 0) + 1,
              };
            });
          } else if (data.type === "topology_complete") {
            const parsedRoutes = Array.isArray(data.routes)
              ? data.routes
              : typeof data.routes === "string"
              ? data.routes
                  .split("\n")
                  .map((s: string) => s.trim())
                  .filter((s: string) => s && !s.includes("not found"))
              : [];
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    topologyRoutes: parsedRoutes,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "AST",
                        text: `AST Topology mapped: ${parsedRoutes.length} active routes/modules verified.`,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "prd_complete") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    prd: data.prd,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Orion",
                        text: `Drafted ${data.prd.id}: "${data.prd.title}" (${data.prd.userStories?.length || 0} user stories, ${data.prd.functionalRequirements?.length || 0} requirements).`,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "adr_complete") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    adr: data.adr,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Daedalus",
                        text: `ADR formulated: ${data.adr.id} (Blast Radius Risk: ${data.adr.blastRadiusRisk}, Strategy: ${data.adr.decision?.slice(0, 50)}...).`,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "plan_complete") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    plan: data.plan,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Vulcan",
                        text: `Plan created: ${data.plan.id} (${data.plan.steps.length} atomic task steps planned).`,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "code_step_start") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    currentCodeStep: {
                      targetFile: data.targetFile,
                      index: data.index,
                      total: data.total,
                    },
                    streamingCode: "",
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Gemma",
                        text: `Synthesizing [${data.index}/${data.total}]: ${data.targetFile}...`,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "code_token") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    streamingCode: (prev.streamingCode || "") + data.token,
                    tokenCount: (prev.tokenCount || 0) + 1,
                  }
                : null
            );
          } else if (data.type === "code_step_done") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Gemma",
                        text: `Written to disk: ${data.targetFile} (${data.codeLength} bytes).`,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "code_complete") {
            setActiveWorkflow((prev) => (prev ? { ...prev, execution: data.execution } : null));
            fetch(`${API_BASE}/workspace`)
              .then((res) => res.json())
              .then((ws) => setFileTree(ws.tree))
              .catch(() => {});
            if (activeFilePath) {
              fetch(`${API_BASE}/file?path=${encodeURIComponent(activeFilePath)}`)
                .then((r) => r.json())
                .then((d) => {
                  if (d.content) {
                    setEditorContent(d.content);
                    setOpenFiles((prev) =>
                      prev.map((f) => (f.path === activeFilePath ? { ...f, content: d.content, isDirty: false } : f))
                    );
                  }
                })
                .catch(() => {});
            }
          } else if (data.type === "self_heal_start") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    selfHeal: {
                      active: true,
                      message: data.message,
                      failingGates: data.failingGates,
                    },
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Aegis",
                        text: `Gate failure detected! Engaging Gemma for surgical patch on: ${data.failingGates?.join(", ")}.`,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "self_heal_success") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    selfHeal: {
                      active: false,
                      message: data.message,
                    },
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Gemma",
                        text: `Surgical patch verified clean! Code self-healed successfully.`,
                      },
                    ],
                  }
                : null
            );
          } else if (data.type === "gate_result") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    gates: [...prev.gates, data.gate],
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Aegis",
                        text: `${data.gate.gateName}: ${data.gate.passed ? "✔ PASS" : "✖ FAIL"} (${data.gate.durationMs}ms)`,
                      },
                    ],
                  }
                : null
            );
            if (data.gate) {
              updateGateStatus([data.gate]);
            }
          } else if (data.type === "finish") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    status: "completed",
                    phaseMessage: "Workflow Completed Successfully!",
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "System",
                        text: "Autonomous engineering cycle complete! All artifacts verified.",
                      },
                    ],
                  }
                : null
            );
            eventSource.close();
            setIsWorking(false);
          } else if (data.type === "error") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    status: "error",
                    error: data.message,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "System",
                        text: `Error: ${data.message}`,
                      },
                    ],
                  }
                : null
            );
            eventSource.close();
            setIsWorking(false);
          }
        } catch (parseErr) {
          console.error("Error parsing SSE stream event:", parseErr);
        }
      };

      eventSource.onerror = (err) => {
        console.error("EventSource stream error:", err);
        eventSource.close();
        setIsWorking(false);
      };
    } catch (err: any) {
      console.error("Failed to start SSE stream:", err);
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
            <span>{(targetRepo || "").split(/[\\/]/).pop() || "workspace"}</span>
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
                <span>{(tab?.path || "").split(/[\\/]/).pop() || "file"}</span>
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
                  renderValidationDecorations: "off",
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
                  {msg.role === "user" ? "YOU" : "METAFRAME AGENTS"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
              </div>
            ))}

            {/* Live Visual Workflow Execution Stepper */}
            {activeWorkflow && (
              <div className="timeline-stepper">
                {/* Stepper Header Status */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent)" }}>
                    LIVE AGENT ORCHESTRATION
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className={`step-badge ${activeWorkflow.status === "completed" ? "emerald" : activeWorkflow.status === "error" ? "amber" : "purple"}`}>
                      {activeWorkflow.status.toUpperCase()}
                    </span>
                    <button
                      type="button"
                      className="clear-session-btn"
                      title="Clear session & reset workflow"
                      onClick={handleResetSession}
                    >
                      <RotateCcw size={10} />
                      <span>Reset</span>
                    </button>
                  </div>
                </div>

                {/* Step 1: AST Topology & Route Navigation */}
                <div className={`timeline-step ${activeWorkflow.currentPhase === 1 ? "active" : activeWorkflow.currentPhase > 1 ? "completed" : ""}`}>
                  <div className="step-header accordion-toggle" onClick={() => toggleStepExpand(1)}>
                    <div className="step-title">
                      {activeWorkflow.currentPhase > 1 ? (
                        <CheckCircle size={14} color="#10b981" />
                      ) : (
                        <span className="pulse-dot" />
                      )}
                      <span>1. AST Topology & Navigation</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="step-badge blue">AST Grounding</span>
                      {expandedSteps.has(1) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </div>
                  </div>
                  {expandedSteps.has(1) && (
                    <div className="step-expand-body">
                      <div className="inspector-section">
                        <div className="inspector-title">Target Workspace</div>
                        <div style={{ color: "var(--text-main)", fontSize: "10px", wordBreak: "break-all" }}>
                          {targetRepo}
                        </div>
                      </div>
                      <div className="inspector-section">
                        <div className="inspector-title">AST Domain Graph</div>
                        <div style={{ color: "var(--text-muted)" }}>
                          Mapped modules, components, and dependency hierarchy for active workspace.
                        </div>
                        {Array.isArray(activeWorkflow.topologyRoutes) && activeWorkflow.topologyRoutes.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                            {activeWorkflow.topologyRoutes.map((r, i) => (
                              <span key={i} className="meta-chip" style={{ background: "rgba(56, 189, 248, 0.1)", color: "#38bdf8" }}>
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 2: Orion - PRD Product Architecture */}
                <div className={`timeline-step ${activeWorkflow.currentPhase === 2 ? "active" : activeWorkflow.prd ? "completed" : ""}`}>
                  <div className="step-header accordion-toggle" onClick={() => toggleStepExpand(2)}>
                    <div className="step-title">
                      {activeWorkflow.prd ? (
                        <CheckCircle size={14} color="#10b981" />
                      ) : activeWorkflow.currentPhase === 2 ? (
                        <span className="pulse-dot" />
                      ) : (
                        <FileText size={14} color="var(--text-dim)" />
                      )}
                      <span>2. Orion · Product Specification</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {activeWorkflow.prd && <span className="step-badge purple">{activeWorkflow.prd.id}</span>}
                      {expandedSteps.has(2) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </div>
                  </div>
                  {expandedSteps.has(2) && (
                    <div className="step-expand-body">
                      {activeWorkflow.prd ? (
                        <>
                          <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "12px" }}>
                            {activeWorkflow.prd.title}
                          </div>
                          {activeWorkflow.prd.overview && (
                            <p style={{ color: "var(--text-muted)", fontSize: "11px", margin: 0 }}>
                              {activeWorkflow.prd.overview}
                            </p>
                          )}

                          {/* User Stories */}
                          {Array.isArray(activeWorkflow.prd.userStories) && activeWorkflow.prd.userStories.length > 0 && (
                            <div className="inspector-section">
                              <div className="inspector-title">User Stories ({activeWorkflow.prd.userStories.length})</div>
                              {activeWorkflow.prd.userStories.map((us: any, idx: number) => (
                                <div key={idx} className="user-story-card">
                                  {typeof us === "string" ? (
                                    us
                                  ) : (
                                    <div>
                                      <span style={{ color: "#c084fc", fontWeight: 700 }}>Story #{idx + 1}</span>
                                      {us.persona && <span style={{ color: "var(--text-dim)" }}> ({us.persona})</span>}
                                      <div style={{ marginTop: 2 }}>
                                        <strong>Want:</strong> {us.want}
                                      </div>
                                      <div style={{ color: "var(--text-muted)", marginTop: 1 }}>
                                        <strong>Benefit:</strong> {us.soThat}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Acceptance Criteria */}
                          {Array.isArray(activeWorkflow.prd.acceptanceCriteria) && activeWorkflow.prd.acceptanceCriteria.length > 0 && (
                            <div className="inspector-section">
                              <div className="inspector-title">Acceptance Criteria</div>
                              {activeWorkflow.prd.acceptanceCriteria.map((ac: string, idx: number) => (
                                <div key={idx} className="criteria-item">
                                  <CheckCircle size={12} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
                                  <span>{ac}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Functional Requirements */}
                          {Array.isArray(activeWorkflow.prd.functionalRequirements) && activeWorkflow.prd.functionalRequirements.length > 0 && (
                            <div className="inspector-section">
                              <div className="inspector-title">Functional Requirements</div>
                              <ul style={{ paddingLeft: 16, margin: 0, color: "var(--text-muted)" }}>
                                {activeWorkflow.prd.functionalRequirements.map((req: string, idx: number) => (
                                  <li key={idx} style={{ margin: "2px 0" }}>{req}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      ) : activeWorkflow.agentTokens?.["Orion"] ? (
                        <div className="streaming-code-terminal">
                          <div className="terminal-header">
                            <div className="terminal-title">
                              <Sparkles size={12} color="#c084fc" />
                              <span>Orion Spec Stream ({activeWorkflow.agentTokens["Orion"].length} chars)</span>
                            </div>
                            <span className="live-indicator"><span className="pulse-dot" /> STREAMING</span>
                          </div>
                          <pre className="terminal-body" style={{ maxHeight: 180, fontSize: "11px" }}>
                            {activeWorkflow.agentTokens["Orion"]}
                          </pre>
                        </div>
                      ) : (
                        <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                          <span className="pulse-dot" />
                          <span>{activeWorkflow.phaseMessage || "Orion is drafting structured PRD, personas, and criteria..."}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Step 3: Daedalus - Solutions Architecture & ADR */}
                <div className={`timeline-step ${activeWorkflow.currentPhase === 3 ? "active" : activeWorkflow.adr ? "completed" : ""}`}>
                  <div className="step-header accordion-toggle" onClick={() => toggleStepExpand(3)}>
                    <div className="step-title">
                      {activeWorkflow.adr ? (
                        <CheckCircle size={14} color="#10b981" />
                      ) : activeWorkflow.currentPhase === 3 ? (
                        <span className="pulse-dot" />
                      ) : (
                        <Layers size={14} color="var(--text-dim)" />
                      )}
                      <span>3. Daedalus · Architectural Decision</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {activeWorkflow.adr && (
                        <span className={`step-badge ${activeWorkflow.adr.blastRadiusRisk === "HIGH" ? "amber" : "emerald"}`}>
                          Risk: {activeWorkflow.adr.blastRadiusRisk}
                        </span>
                      )}
                      {expandedSteps.has(3) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </div>
                  </div>
                  {expandedSteps.has(3) && (
                    <div className="step-expand-body">
                      {activeWorkflow.adr ? (
                        <>
                          <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "12px" }}>
                            {activeWorkflow.adr.title} ({activeWorkflow.adr.id})
                          </div>
                          {activeWorkflow.adr.decision && (
                            <div className="inspector-section">
                              <div className="inspector-title">Architecture Decision</div>
                              <p style={{ color: "var(--text-main)", margin: 0, background: "rgba(244, 114, 182, 0.06)", padding: "6px 8px", borderRadius: 4, border: "1px solid rgba(244, 114, 182, 0.15)" }}>
                                {activeWorkflow.adr.decision}
                              </p>
                            </div>
                          )}
                          {activeWorkflow.adr.context && (
                            <div className="inspector-section">
                              <div className="inspector-title">Context & Justification</div>
                              <p style={{ color: "var(--text-muted)", margin: 0 }}>
                                {activeWorkflow.adr.context}
                              </p>
                            </div>
                          )}
                          {Array.isArray(activeWorkflow.adr.impactedModules) && activeWorkflow.adr.impactedModules.length > 0 && (
                            <div className="inspector-section">
                              <div className="inspector-title">Impacted Modules & Components</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {activeWorkflow.adr.impactedModules.map((m: string, idx: number) => (
                                  <span key={idx} className="file-link-pill" onClick={() => handleOpenFile(m)}>
                                    {m}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {activeWorkflow.adr.consequences && (
                            <div className="inspector-section">
                              <div className="inspector-title">Trade-offs & Consequences</div>
                              {Array.isArray(activeWorkflow.adr.consequences.positive) && activeWorkflow.adr.consequences.positive.map((p: string, idx: number) => (
                                <div key={idx} style={{ color: "#34d399", display: "flex", gap: 6, fontSize: "11px" }}>
                                  <span>✔</span>
                                  <span>{p}</span>
                                </div>
                              ))}
                              {Array.isArray(activeWorkflow.adr.consequences.risks) && activeWorkflow.adr.consequences.risks.map((r: string, idx: number) => (
                                <div key={idx} style={{ color: "#f59e0b", display: "flex", gap: 6, fontSize: "11px" }}>
                                  <span>⚠</span>
                                  <span>{r}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : activeWorkflow.agentTokens?.["Daedalus"] ? (
                        <div className="streaming-code-terminal">
                          <div className="terminal-header">
                            <div className="terminal-title">
                              <Layers size={12} color="#f472b6" />
                              <span>Daedalus ADR Stream ({activeWorkflow.agentTokens["Daedalus"].length} chars)</span>
                            </div>
                            <span className="live-indicator"><span className="pulse-dot" /> STREAMING</span>
                          </div>
                          <pre className="terminal-body" style={{ maxHeight: 180, fontSize: "11px" }}>
                            {activeWorkflow.agentTokens["Daedalus"]}
                          </pre>
                        </div>
                      ) : (
                        <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                          <span className="pulse-dot" />
                          <span>{activeWorkflow.phaseMessage || "Calculating AST blast radius & selecting architecture pattern..."}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Step 4: Vulcan - Implementation Task Plan */}
                <div className={`timeline-step ${activeWorkflow.currentPhase === 4 ? "active" : activeWorkflow.plan ? "completed" : ""}`}>
                  <div className="step-header accordion-toggle" onClick={() => toggleStepExpand(4)}>
                    <div className="step-title">
                      {activeWorkflow.plan ? (
                        <CheckCircle size={14} color="#10b981" />
                      ) : activeWorkflow.currentPhase === 4 ? (
                        <span className="pulse-dot" />
                      ) : (
                        <Clock size={14} color="var(--text-dim)" />
                      )}
                      <span>4. Vulcan · Atomic Execution Plan</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {activeWorkflow.plan && Array.isArray(activeWorkflow.plan.steps) && (
                        <span className="step-badge amber">{activeWorkflow.plan.steps.length} Steps</span>
                      )}
                      {expandedSteps.has(4) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </div>
                  </div>
                  {expandedSteps.has(4) && (
                    <div className="step-expand-body">
                      {activeWorkflow.plan && Array.isArray(activeWorkflow.plan.steps) ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {activeWorkflow.plan.steps.map((st: any, i: number) => {
                            const file = st.targetFile || st.filePath || "";
                            const action = st.actionType || st.type || "MODIFY";
                            return (
                              <div key={i} className="task-step-item" style={{ flexDirection: "column", background: "rgba(255, 255, 255, 0.02)", padding: 8, borderRadius: 6, border: "1px solid rgba(255, 255, 255, 0.05)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", width: "100%" }}>
                                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>Task #{st.order || i + 1}</span>
                                  <span
                                    className="file-link-pill"
                                    title="Click to open file in editor"
                                    onClick={() => file && handleOpenFile(file)}
                                  >
                                    <FileCode size={11} />
                                    <span>{file ? file.split(/[\\/]/).pop() : "file"}</span>
                                  </span>
                                  <span style={{
                                    fontSize: "10px",
                                    color: action === "CREATE" ? "#34d399" : action === "DELETE" ? "#ef4444" : "#38bdf8",
                                    background: action === "CREATE" ? "rgba(52, 211, 153, 0.1)" : "rgba(56, 189, 248, 0.1)",
                                    padding: "1px 5px",
                                    borderRadius: 3,
                                    fontWeight: 700,
                                  }}>
                                    {action}
                                  </span>
                                </div>
                                <div style={{ fontSize: "11px", color: "var(--text-main)", marginTop: 4 }}>
                                  {st.description}
                                </div>
                                {st.testCriteria && (
                                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: 4, display: "flex", gap: 4 }}>
                                    <span style={{ color: "#fbbf24", fontWeight: 700 }}>Verification Criteria:</span>
                                    <span>{st.testCriteria}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : activeWorkflow.agentTokens?.["Vulcan"] ? (
                        <div className="streaming-code-terminal">
                          <div className="terminal-header">
                            <div className="terminal-title">
                              <FileCode size={12} color="#fbbf24" />
                              <span>Vulcan Task Plan Stream ({activeWorkflow.agentTokens["Vulcan"].length} chars)</span>
                            </div>
                            <span className="live-indicator"><span className="pulse-dot" /> STREAMING</span>
                          </div>
                          <pre className="terminal-body" style={{ maxHeight: 180, fontSize: "11px" }}>
                            {activeWorkflow.agentTokens["Vulcan"]}
                          </pre>
                        </div>
                      ) : (
                        <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                          <span className="pulse-dot" />
                          <span>{activeWorkflow.phaseMessage || "Generating surgical, atomic file modifications..."}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Step 5: Autonomous Code Generation & Disk Write */}
                {autoCodeWrite && (
                  <div className={`timeline-step ${activeWorkflow.currentPhase === 5 ? "active" : activeWorkflow.execution ? "completed" : ""}`}>
                    <div className="step-header accordion-toggle" onClick={() => toggleStepExpand(5)}>
                      <div className="step-title">
                        {activeWorkflow.execution?.overallSuccess ? (
                          <CheckCircle size={14} color="#10b981" />
                        ) : activeWorkflow.currentPhase === 5 ? (
                          <span className="pulse-dot" />
                        ) : (
                          <Cpu size={14} color="var(--text-dim)" />
                        )}
                        <span>5. Gemma 4 · Live Code Generation</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {activeWorkflow.execution && Array.isArray(activeWorkflow.execution.executedSteps) && (
                          <span className="step-badge emerald">
                            {activeWorkflow.execution.executedSteps.length} Files Written
                          </span>
                        )}
                        {expandedSteps.has(5) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </div>
                    </div>
                    {expandedSteps.has(5) && (
                      <div className="step-expand-body">
                        {activeWorkflow.execution && Array.isArray(activeWorkflow.execution.executedSteps) ? (
                          <div>
                            <div style={{ color: "#34d399", fontWeight: 600, marginBottom: 4 }}>
                              ✔ Successfully written to workspace disk:
                            </div>
                            {activeWorkflow.execution.executedSteps.map((st: any, idx: number) => {
                              const file = st.filePath || st.targetFile || st.step?.targetFile || "";
                              return (
                                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, margin: "2px 0" }}>
                                  <span
                                    className="file-link-pill"
                                    onClick={() => file && handleOpenFile(file)}
                                  >
                                    <FileCode size={11} />
                                    <span>{file ? file.split(/[\\/]/).pop() : "file"}</span>
                                  </span>
                                  <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                                    ({st.codeLength || 0} bytes)
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : activeWorkflow.currentPhase === 5 ? (
                          <div>
                            <div style={{ fontSize: "11px", color: "#38bdf8", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                              <span className="pulse-dot green" />
                              <span>
                                {activeWorkflow.currentCodeStep
                                  ? `Live Code Synthesis: ${activeWorkflow.currentCodeStep.targetFile} [${activeWorkflow.currentCodeStep.index}/${activeWorkflow.currentCodeStep.total}]`
                                  : "Gemma 4 GPU synthesizing code..."}
                              </span>
                            </div>

                            {/* Live Monospaced Terminal with real-time autoscroll */}
                            <div className="streaming-code-terminal">
                              <div className="terminal-header">
                                <span style={{ color: "#94a3b8" }}>
                                  {activeWorkflow.currentCodeStep?.targetFile || "source_stream.tsx"}
                                </span>
                                <span style={{ color: "#38bdf8", fontWeight: 700 }}>
                                  {activeWorkflow.tokenCount || 0} tokens
                                </span>
                              </div>
                              <div
                                className="terminal-body"
                                ref={(el) => {
                                  if (el) el.scrollTop = el.scrollHeight;
                                }}
                              >
                                {activeWorkflow.streamingCode || "// Establishing GPU token stream...\n// Preparing syntax AST..."}
                                <span className="terminal-cursor">▋</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: "var(--text-muted)" }}>
                            Awaiting Vulcan plan approval to begin code synthesis.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Self-Healing Loop Status */}
                {activeWorkflow.selfHeal && (
                  <div className="timeline-step active" style={{ borderColor: "#f59e0b" }}>
                    <div className="step-header">
                      <div className="step-title" style={{ color: "#f59e0b" }}>
                        <Flame size={14} color="#f59e0b" />
                        <span>Self-Healing Closed Loop</span>
                      </div>
                      <span className="step-badge amber">Surgical Patch</span>
                    </div>
                    <div className="step-details">
                      {activeWorkflow.selfHeal.message}
                    </div>
                  </div>
                )}

                {/* Step 6: Aegis - Deterministic 6-Gate Verification */}
                <div className={`timeline-step ${activeWorkflow.currentPhase === 6 || activeWorkflow.gates.length > 0 ? "active" : ""}`}>
                  <div className="step-header accordion-toggle" onClick={() => toggleStepExpand(6)}>
                    <div className="step-title">
                      {activeWorkflow.gates.length >= 6 ? (
                        <CheckCircle size={14} color="#10b981" />
                      ) : activeWorkflow.currentPhase === 6 ? (
                        <span className="pulse-dot" />
                      ) : (
                        <Shield size={14} color="var(--text-dim)" />
                      )}
                      <span>6. Aegis · Deterministic 6-Gate Quality</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="step-badge emerald">
                        {activeWorkflow.gates.filter((g) => g.passed).length}/{activeWorkflow.gates.length || 6} Gates
                      </span>
                      {expandedSteps.has(6) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </div>
                  </div>
                  {expandedSteps.has(6) && activeWorkflow.gates.length > 0 && (
                    <div className="step-expand-body">
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {activeWorkflow.gates.map((g, idx) => (
                          <div
                            key={idx}
                            className={`gate-chip ${g.passed ? "pass" : "fail"}`}
                            style={{ fontSize: "10px", padding: "3px 8px" }}
                          >
                            {g.passed ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                            <span>{g.gateName} ({g.durationMs}ms)</span>
                          </div>
                        ))}
                      </div>
                      {activeWorkflow.gates.some((g) => !g.passed && g.errors?.length > 0) && (
                        <div className="inspector-section" style={{ marginTop: 4 }}>
                          <div className="inspector-title" style={{ color: "#ef4444" }}>Gate Feedback & Violations</div>
                          {activeWorkflow.gates.filter((g) => !g.passed).map((g, i) => (
                            <div key={i} style={{ background: "rgba(239, 68, 68, 0.08)", padding: 6, borderRadius: 4, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                              <strong style={{ color: "#ef4444" }}>{g.gateName}:</strong>
                              <ul style={{ margin: "2px 0 0 16px", color: "var(--text-muted)" }}>
                                {g.errors.map((err: string, ei: number) => (
                                  <li key={ei}>{err}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Multi-Agent Live Activity Feed & Telemetry ── */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "10px", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      <Activity size={12} color="var(--accent)" />
                      <span>Multi-Agent Live Activity Telemetry</span>
                    </div>
                    <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                      {activeWorkflow.logs?.length || 0} events
                    </span>
                  </div>
                  <div className="activity-feed">
                    {activeWorkflow.logs?.map((log, idx) => (
                      <div key={idx} className="activity-log-line">
                        <span className="log-time">[{log.time}]</span>
                        <span className={`log-agent ${log.agent}`}>[{log.agent}]</span>
                        <span className="log-text">{log.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Error Banner if workflow failed */}
                {activeWorkflow.error && (
                  <div style={{ color: "#ef4444", fontSize: "11px", padding: "8px", background: "rgba(239, 68, 68, 0.1)", borderRadius: "6px" }}>
                    ⚠ Error: {activeWorkflow.error}
                  </div>
                )}
              </div>
            )}
          </div>

          <form className="copilot-input-container" onSubmit={handleCopilotSubmit}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "11px", color: autoCodeWrite ? "#34d399" : "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={autoCodeWrite}
                  onChange={(e) => setAutoCodeWrite(e.target.checked)}
                  style={{ accentColor: "#8b5cf6" }}
                />
                <span style={{ fontWeight: 600 }}>Auto-Write Code to Disk (Gemma 4 GPU)</span>
              </label>
              <span style={{ fontSize: "10px", color: autoCodeWrite ? "#38bdf8" : "var(--text-dim)" }}>
                {autoCodeWrite ? "⚡ Auto-Modify Active" : "📋 Plan Only"}
              </span>
            </div>
            <textarea
              className="copilot-textarea"
              placeholder="Ask MetaFrame to write code, build a component, or refactor..."
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
