import React, { useState, useEffect, useRef, useMemo } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { marked } from "marked";
import hljs from "highlight.js";
import "highlight.js/styles/tokyo-night-dark.min.css";

export function detectComponentNameFromCode(code: string): string | null {
  if (!code || typeof code !== "string") return null;
  const m1 = code.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/);
  if (m1 && m1[1] && m1[1] !== "function") return m1[1];
  const m2 = code.match(/export\s+default\s+([A-Za-z0-9_]+)\s*;?/);
  if (m2 && m2[1] && m2[1] !== "React") return m2[1];
  const m3 = code.match(/(?:const|function)\s+([A-Z][a-zA-Z0-9_]*)\s*(?::\s*React\.FC|:\s*FC|\s*=\s*\([^)]*\)\s*=>|\s*\()/);
  if (m3 && m3[1]) return m3[1];
  const m4 = code.match(/export\s+(?:const|function)\s+([A-Z][a-zA-Z0-9_]*)/);
  if (m4 && m4[1]) return m4[1];
  return null;
}

const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const validLang = lang && hljs.getLanguage(lang) ? lang : undefined;
  const highlighted = validLang
    ? hljs.highlight(text, { language: validLang, ignoreIllegals: true }).value
    : hljs.highlightAuto(text).value;

  const fileMatch = text.match(/^(?:\/\/\s*|\/\*\s*)([a-zA-Z0-9_\-./\\]+\.(?:tsx?|jsx?|css|html|json))\b/m);
  let detectedFile = fileMatch ? fileMatch[1].replace(/\\/g, "/") : "";

  // If no explicit file comment, detect from component name
  const comp = detectComponentNameFromCode(text);
  if (!detectedFile && comp) {
    detectedFile = comp === "App" ? "src/App.tsx" : `src/components/${comp}.tsx`;
  }

  // Safety guard: NEVER allow subcomponents to target App.tsx
  if ((detectedFile === "src/App.tsx" || detectedFile === "App.tsx") && comp && comp !== "App") {
    detectedFile = `src/components/${comp}.tsx`;
  }

  // Detect lazy placeholder comments (// ... (önceki kodlar), {/* ... */}, etc.)
  const hasPlaceholders =
    /\{\s*\/\*\s*\.{3}.*?\*\/\s*\}|\/\/\s*\.{3}|\/\*\s*\.{3}.*?\*\//i.test(text) ||
    /\/\/\s*.*\b(?:önceki|kalan|diğer|existing|rest of|unchanged)\b.*\b(?:kod|code|state|fonksiyon|implement)/i.test(text) ||
    /\.\.\.\s*(?:önceki|kalan|diğer|rest of|existing)\s*(?:kodlar|kod|code)/i.test(text);

  const applyBtnHtml = hasPlaceholders
    ? `<button class="code-block-apply placeholder-warning" data-code="${encodeURIComponent(text)}" data-file="${detectedFile}" data-has-placeholders="true" title="Bu kod bloğunda yer tutucu yorumlar var (// ...). Doğrudan uygulanırsa dosyadaki diğer kodları siler!">
        ⚠️ Yer Tutucu Var (Eksik Kod)
      </button>`
    : `<button class="code-block-apply" data-code="${encodeURIComponent(text)}" data-file="${detectedFile}" title="Bu kodu aktif editöre ve dosyaya uygula">
        ⚡ Editöre Uygula
      </button>`;

  return `<div class="code-block-wrapper" data-file="${detectedFile}">
  <div class="code-block-header">
    <div class="code-block-header-left">
      <span class="code-block-lang">${validLang || "code"}</span>
      ${detectedFile ? `<span class="code-block-file">📁 ${detectedFile}</span>` : ""}
    </div>
    <div class="code-block-actions">
      ${applyBtnHtml}
      <button class="code-block-copy" data-code="${encodeURIComponent(text)}" title="Kodu kopyala">
        📋 Kopyala
      </button>
    </div>
  </div>
  <pre><code class="hljs ${validLang || ""}">${highlighted}</code></pre>
</div>`;
};

marked.use({
  gfm: true,
  breaks: true,
  renderer,
});

interface MarkdownRendererProps {
  content: string;
  onApplyCode?: (code: string, targetFile?: string) => Promise<boolean | void> | boolean | void;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, onApplyCode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }, [content]);

  const handleClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    // 1. Copy Button
    const copyBtn = (e.target as HTMLElement).closest(".code-block-copy") as HTMLButtonElement | null;
    if (copyBtn) {
      const raw = copyBtn.getAttribute("data-code");
      if (raw) {
        const code = decodeURIComponent(raw);
        navigator.clipboard.writeText(code);
        const originalText = copyBtn.innerText;
        copyBtn.innerText = "✓ Kopyalandı!";
        setTimeout(() => {
          copyBtn.innerText = originalText;
        }, 2000);
      }
      return;
    }

    // 2. Apply Code Button
    const applyBtn = (e.target as HTMLElement).closest(".code-block-apply") as HTMLButtonElement | null;
    if (applyBtn) {
      if (applyBtn.getAttribute("data-has-placeholders") === "true") {
        alert(
          "⚠️ Tehlike Engellendi: Bu kod bloğu '// ... (önceki kodlar)' veya '{/* ... */}' gibi yer tutucu yorumlar içeriyor!\n\n" +
          "Bu kodu doğrudan editöre uygulamak, dosyadaki diğer tüm çalışan kodların (state, buton, menü) silinmesine yol açar.\n\n" +
          "Lütfen sohbetten şunu isteyin:\n'Kodu hiçbir yer tutucu olmadan, tüm dosyayı baştan sona eksiksiz olarak tekrar yaz.'"
        );
        return;
      }
      const rawCode = applyBtn.getAttribute("data-code");
      const fileAttr = applyBtn.getAttribute("data-file") || undefined;
      if (rawCode && onApplyCode) {
        const code = decodeURIComponent(rawCode);
        applyBtn.disabled = true;
        applyBtn.innerText = "⏳ Uygulanıyor...";
        try {
          await onApplyCode(code, fileAttr);
          applyBtn.innerText = "✔ Uygulandı!";
          applyBtn.classList.add("applied");
          setTimeout(() => {
            applyBtn.innerText = "⚡ Editöre Uygula";
            applyBtn.disabled = false;
            applyBtn.classList.remove("applied");
          }, 3000);
        } catch {
          applyBtn.innerText = "✖ Hata!";
          setTimeout(() => {
            applyBtn.innerText = "⚡ Editöre Uygula";
            applyBtn.disabled = false;
          }, 2000);
        }
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="markdown-chat-body"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
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
  Check,
  X,
  Sparkles,
  Layers,
  FileText,
  Clock,
  Activity,
  RotateCcw,
  Terminal as TerminalIcon,
  Trash2,
  Square,
  Maximize2,
  Minimize2,
  CornerDownLeft,
  Headphones,
  Compass,
  Bot,
  Bug,
  Paperclip,
  Plus,
  Search,
  Image as ImageIcon,
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
  status: "idle" | "running" | "completed" | "error" | "interrupted";
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
  stepTokenCount?: number;
  selfHeal?: { active: boolean; message?: string; failingGates?: string[] };
  gates: any[];
  logs: ActivityLog[];
  error?: string;
}

interface TerminalEntry {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  time: string;
  cwd: string;
}

export type StudioMode = "vibe" | "engineering" | "mimar" | "autonomous" | "debugger" | "chat";

interface ModeConfig {
  id: StudioMode;
  name: string;
  tagline: string;
  badge: string;
  color: string;
  glow: string;
  suggestions: string[];
}

interface VibeSession {
  prompt: string;
  targetFile: string;
  status: "idle" | "generating" | "applied" | "error";
  streamingCode: string;
  tokenCount: number;
  durationMs?: number;
  bytes?: number;
  error?: string;
  logs: { time: string; text: string }[];
}

const STUDIO_MODES: Record<StudioMode, ModeConfig> = {
  chat: {
    id: "chat",
    name: "Sohbet",
    tagline: "Proje hakkında konuş, sorular sor, mimari tartış veya kod analizi iste.",
    badge: "CHAT 💬",
    color: "#10b981",
    glow: "rgba(16, 185, 129, 0.22)",
    suggestions: [
      "Bu projenin yapısını ve dosyalarını açıkla",
      "Navbar bileşenini nasıl refactor edebiliriz?",
      "Performansı artırmak için neler önerirsin?",
      "Projedeki bağımlılıklar ve routing nasıl çalışıyor?",
    ],
  },
  vibe: {
    id: "vibe",
    name: "Vibe Coding",
    tagline: "Direct Code Generation: Kullanıcı ister, sistem yazar. PRD/ADR yok, anında kod.",
    badge: "DIRECT CODE ⚡",
    color: "#ec4899",
    glow: "rgba(236, 72, 153, 0.22)",
    suggestions: [
      "Modern Glassmorphism Card",
      "Neon Cyberpunk Hero Section",
      "Hızlı Buton & Input Seti",
      "Smooth Animasyonlu Liste",
    ],
  },
  engineering: {
    id: "engineering",
    name: "Engineering",
    tagline: "Katı derleyici disiplini, tam 6-Gate kalite zinciri ve tip güvenliği.",
    badge: "STRICT 🛡️",
    color: "#8b5cf6",
    glow: "rgba(139, 92, 246, 0.22)",
    suggestions: [
      "TypeScript Strict Type Refactor",
      "Run Full 6-Gate Quality Audit",
      "Zero-Emoji & Token Cleanse",
      "Transitive Blast Radius Safe Refactor",
    ],
  },
  mimar: {
    id: "mimar",
    name: "Mimar Modu",
    tagline: "PRD -> ADR -> AST Topological Blueprint & Sistem Tasarımı.",
    badge: "ARCHITECT 🏛️",
    color: "#f59e0b",
    glow: "rgba(245, 158, 11, 0.22)",
    suggestions: [
      "Draft System PRD & User Stories",
      "Architecture Decision Record (ADR)",
      "AST Dependency Mapping",
      "Database Schema & Migrations Map",
    ],
  },
  autonomous: {
    id: "autonomous",
    name: "Autonomous Modu",
    tagline: "Lead Orchestrator (Orion -> Daedalus -> Vulcan) & Healer Self-Correction.",
    badge: "AUTONOMOUS 🤖",
    color: "#06b6d4",
    glow: "rgba(6, 182, 212, 0.22)",
    suggestions: [
      "Full Autonomous Feature Lifecycle",
      "Auto-Heal Failing Gates Loop",
      "End-to-End Screen Generator",
      "Full Repo Intelligence Scan",
    ],
  },
  debugger: {
    id: "debugger",
    name: "Debugger",
    tagline: "Derin AST sorguları, hata izleme, transitive blast-radius ve PowerShell konsolu.",
    badge: "DEBUG 🐞",
    color: "#ef4444",
    glow: "rgba(239, 68, 68, 0.22)",
    suggestions: [
      "Find Callers of Active Component",
      "AST Blast Radius Breakdown",
      "Check Broken Imports & Exports",
      "Run TypeScript Compiler Diagnostics",
    ],
  },
};

export function App() {
  const [studioMode, setStudioMode] = useState<StudioMode>(() => {
    try {
      const saved = localStorage.getItem("metaframe_studio_mode") as StudioMode;
      if (saved && STUDIO_MODES[saved]) return saved;
    } catch {}
    return "engineering";
  });

  const [autoCodeWrite, setAutoCodeWrite] = useState(true);

  const handleSelectMode = (mode: StudioMode) => {
    setStudioMode(mode);
    try {
      localStorage.setItem("metaframe_studio_mode", mode);
    } catch {}

    if (mode === "debugger") {
      setIsTerminalOpen(true);
      setTerminalHistory((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          command: "# DEBUGGER MODU AKTİF (PowerShell & AST Diagnostic Engine)",
          stdout: "Terminal ve AST çağrı zinciri devrede.\n'dir', 'git status', 'bun test' komutlarını çalıştırabilir veya sorgu yapabilirsiniz.\n",
          stderr: "",
          exitCode: 0,
          time: new Date().toLocaleTimeString(),
          cwd: terminalCwd || targetRepo,
        },
      ]);
    } else if (mode === "vibe") {
      setAutoCodeWrite(true);
    } else if (mode === "mimar") {
      setAutoCodeWrite(false);
    }
  };

  const [targetRepo, setTargetRepo] = useState("");
  const [fileTree, setFileTree] = useState<FileNode[]>([]);

  const allProjectFiles = useMemo(() => {
    const list: string[] = [];
    const traverse = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.isDirectory && n.children) traverse(n.children);
        else if (!n.isDirectory) list.push(n.path);
      }
    };
    traverse(fileTree);
    return list;
  }, [fileTree]);
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
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const activeFilePathRef = useRef<string>(activeFilePath);
  activeFilePathRef.current = activeFilePath;
  const editorContentRef = useRef<string>(editorContent);
  editorContentRef.current = editorContent;
  const [editorMode, setEditorMode] = useState<"code" | "diff">("code");
  const [diffOriginal, setDiffOriginal] = useState<string>("");
  const [diffModified, setDiffModified] = useState<string>("");
  const [stagedDiff, setStagedDiff] = useState<{
    targetFile: string;
    originalCode: string;
    stagedCode: string;
    additions: number;
    deletions: number;
  } | null>(null);
  const [reviewMode, setReviewMode] = useState<boolean>(true);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([1, 2, 3, 4, 5, 6]));
  const [vibeSession, setVibeSession] = useState<VibeSession | null>(null);

  // Integrated Terminal State
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("metaframe_terminal_height");
      if (saved) return Number(saved);
    } catch {}
    return 240;
  });

  // Resizable Panels State
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("metaframe_sidebar_width");
      if (saved) return Number(saved);
    } catch {}
    return 260;
  });

  const [copilotWidth, setCopilotWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("metaframe_copilot_width");
      if (saved) return Number(saved);
    } catch {}
    return 360;
  });

  const [isResizing, setIsResizing] = useState<"sidebar" | "copilot" | "terminal" | null>(null);
  const sidebarPanelRef = useRef<HTMLElement | null>(null);
  const copilotPanelRef = useRef<HTMLElement | null>(null);
  const terminalPanelRef = useRef<HTMLDivElement | null>(null);
  const editorPanelRef = useRef<HTMLElement | null>(null);

  // Drag handlers
  const handleSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing("sidebar");
    const startX = e.clientX;
    const startW = sidebarPanelRef.current ? sidebarPanelRef.current.getBoundingClientRect().width : sidebarWidth;

    const onMouseMove = (moveEv: MouseEvent) => {
      const delta = moveEv.clientX - startX;
      const nextW = Math.max(160, Math.min(600, Math.round(startW + delta)));
      setSidebarWidth(nextW);
    };

    const onMouseUp = () => {
      setIsResizing(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleCopilotMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing("copilot");
    const startX = e.clientX;
    const startW = copilotPanelRef.current ? copilotPanelRef.current.getBoundingClientRect().width : copilotWidth;

    const onMouseMove = (moveEv: MouseEvent) => {
      const delta = startX - moveEv.clientX;
      const nextW = Math.max(260, Math.min(700, Math.round(startW + delta)));
      setCopilotWidth(nextW);
    };

    const onMouseUp = () => {
      setIsResizing(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleTerminalMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing("terminal");
    const startY = e.clientY;
    const startH = terminalPanelRef.current ? terminalPanelRef.current.getBoundingClientRect().height : terminalHeight;
    const editorTotalH = editorPanelRef.current ? editorPanelRef.current.getBoundingClientRect().height : (window.innerHeight - 80);
    const maxH = Math.max(120, Math.round(editorTotalH - 90));

    const onMouseMove = (moveEv: MouseEvent) => {
      const delta = startY - moveEv.clientY;
      const nextH = Math.max(70, Math.min(maxH, Math.round(startH + delta)));
      setTerminalHeight(nextH);
    };

    const onMouseUp = () => {
      setIsResizing(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  useEffect(() => {
    try {
      localStorage.setItem("metaframe_sidebar_width", String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("metaframe_copilot_width", String(copilotWidth));
    } catch {}
  }, [copilotWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("metaframe_terminal_height", String(terminalHeight));
    } catch {}
  }, [terminalHeight]);
  const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([
    {
      id: "welcome",
      command: "",
      stdout: "MetaFrame Cyber Terminal [PowerShell / Shell]\nType any shell command below (e.g. 'git status', 'bun test', 'dir').\nPress Ctrl+` or click the Terminal button to toggle.\n",
      stderr: "",
      exitCode: 0,
      time: new Date().toLocaleTimeString(),
      cwd: "",
    },
  ]);
  const [terminalInput, setTerminalInput] = useState("");
  const [isExecutingCmd, setIsExecutingCmd] = useState(false);
  const [cmdHistoryList, setCmdHistoryList] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [terminalCwd, setTerminalCwd] = useState<string>("");
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const terminalInputRef = useRef<HTMLInputElement | null>(null);

  const handleExecuteTerminal = async (cmdToRun?: string) => {
    const cmd = (cmdToRun !== undefined ? cmdToRun : terminalInput).trim();
    if (!cmd || isExecutingCmd) return;

    setCmdHistoryList((prev) => [cmd, ...prev.filter((c) => c !== cmd)]);
    setHistoryIndex(-1);
    setTerminalInput("");
    setIsExecutingCmd(true);

    try {
      const res = await fetch(`${API_BASE}/terminal/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();

      if (data.clear) {
        setTerminalHistory([]);
      } else {
        setTerminalHistory((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).substring(7),
            command: cmd,
            stdout: data.stdout || "",
            stderr: data.stderr || "",
            exitCode: data.exitCode ?? 0,
            time: new Date().toLocaleTimeString(),
            cwd: data.cwd || terminalCwd || targetRepo,
          },
        ]);
      }
      if (data.cwd) setTerminalCwd(data.cwd);
    } catch (e: any) {
      setTerminalHistory((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          command: cmd,
          stdout: "",
          stderr: e.message || "Failed to reach backend terminal API",
          exitCode: 1,
          time: new Date().toLocaleTimeString(),
          cwd: terminalCwd || targetRepo,
        },
      ]);
    } finally {
      setIsExecutingCmd(false);
      setTimeout(() => {
        terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
        terminalInputRef.current?.focus();
      }, 50);
    }
  };

  const handleTerminalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleExecuteTerminal();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistoryList.length === 0) return;
      const nextIdx = Math.min(historyIndex + 1, cmdHistoryList.length - 1);
      setHistoryIndex(nextIdx);
      setTerminalInput(cmdHistoryList[nextIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setTerminalInput("");
      } else {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setTerminalInput(cmdHistoryList[nextIdx]);
      }
    }
  };

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
    "Anti-Cheat": true,
  });

  // Blast Radius State
  const [blastData, setBlastData] = useState<{ risk: "LOW" | "MEDIUM" | "HIGH"; affectedFiles: string[] } | null>(null);

  // User Explicit AI Context Files
  const [contextFiles, setContextFiles] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("metaframe_context_files");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [showAddContextModal, setShowAddContextModal] = useState(false);
  const [contextSearchQuery, setContextSearchQuery] = useState("");
  const [atMentionQuery, setAtMentionQuery] = useState<string | null>(null);

  // User Attached Images (Vision)
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (re) => {
            if (re.target?.result) {
              setAttachedImages((prev) => [...prev, re.target!.result as string]);
            }
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (re) => {
          if (re.target?.result) {
            setAttachedImages((prev) => [...prev, re.target!.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (re) => {
          if (re.target?.result) {
            setAttachedImages((prev) => [...prev, re.target!.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem("metaframe_context_files", JSON.stringify(contextFiles));
    } catch {}
  }, [contextFiles]);

  const toggleContextFile = (filePath: string) => {
    setContextFiles((prev) =>
      prev.includes(filePath) ? prev.filter((p) => p !== filePath) : [...prev, filePath]
    );
  };

  const addContextFile = (filePath: string) => {
    setContextFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
  };

  const removeContextFile = (filePath: string) => {
    setContextFiles((prev) => prev.filter((p) => p !== filePath));
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCopilotPrompt(val);

    const cursorPos = e.target.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_\-./]*)$/);
    if (atMatch) {
      setAtMentionQuery(atMatch[1].toLowerCase());
    } else {
      setAtMentionQuery(null);
    }
  };

  const handleSelectAtMention = (filePath: string) => {
    addContextFile(filePath);
    if (atMentionQuery !== null) {
      const atRegex = new RegExp(`@${atMentionQuery}$`);
      setCopilotPrompt((prev) => prev.replace(atRegex, "").trimEnd() + " ");
    }
    setAtMentionQuery(null);
  };

  const atMentionMatches = useMemo(() => {
    if (atMentionQuery === null) return [];
    return allProjectFiles
      .filter((f) => {
        const lower = f.toLowerCase();
        return lower.includes(atMentionQuery) || (f.split("/").pop() || "").toLowerCase().includes(atMentionQuery);
      })
      .slice(0, 6);
  }, [atMentionQuery, allProjectFiles]);

  const modalFilteredFiles = useMemo(() => {
    const q = contextSearchQuery.trim().toLowerCase();
    if (!q) return allProjectFiles.slice(0, 60);
    return allProjectFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 60);
  }, [contextSearchQuery, allProjectFiles]);

  // Copilot State
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string; images?: string[]; plan?: any }>>(() => {
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
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [chatStreamingText, setChatStreamingText] = useState("");
  const currentEventSourceRef = useRef<EventSource | null>(null);
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);

  const [activeWorkflow, setActiveWorkflow] = useState<ActiveWorkflow | null>(() => {
    try {
      const saved = localStorage.getItem("metaframe_active_workflow");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.status === "running") parsed.status = "interrupted";
        return parsed;
      }
    } catch {}
    return null;
  });

  // Clear only telemetry activity feed logs
  const handleClearTelemetry = () => {
    setActiveWorkflow((prev) =>
      prev
        ? {
            ...prev,
            logs: [],
          }
        : null
    );
  };

  // Immediate clean slate: Clears chat messages, workflow, and local storage without popup friction
  const handleClearAll = () => {
    if (currentEventSourceRef.current) {
      currentEventSourceRef.current.close();
      currentEventSourceRef.current = null;
    }
    setIsWorking(false);
    setActiveWorkflow(null);
    setVibeSession(null);
    localStorage.removeItem("metaframe_active_workflow");
    setChatMessages([
      {
        role: "system",
        content: "MetaFrame Agentic Core online. Ready to plan, verify, and ground code in AST topology.",
      },
    ]);
    localStorage.removeItem("metaframe_chat_messages");
  };

  // Immediate abort / cancel handler for in-flight streams
  const handleAbortExecution = () => {
    if (currentEventSourceRef.current) {
      currentEventSourceRef.current.close();
      currentEventSourceRef.current = null;
    }
    setIsWorking(false);
    setActiveWorkflow((prev) =>
      prev
        ? {
            ...prev,
            status: "interrupted",
            phaseMessage: "İşlem kullanıcı tarafından durduruldu.",
            logs: [
              ...prev.logs,
              {
                time: new Date().toTimeString().slice(0, 8),
                agent: "System",
                text: "⏹ İşlem kullanıcı tarafından durduruldu.",
              },
            ],
          }
        : null
    );
    setVibeSession((prev) =>
      prev ? { ...prev, status: "idle", message: "İşlem durduruldu." } : null
    );
  };

  // Session Reset Handler
  const handleResetSession = () => {
    handleClearAll();
  };

  // Autoscroll terminal on streaming token updates
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [activeWorkflow?.streamingCode]);

  // Sync state to localStorage with debouncing & sanitized transient stream payloads
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (activeWorkflow) {
          const sanitized = {
            ...activeWorkflow,
            streamingCode: "", // transient, not needed after session restore
          };
          localStorage.setItem("metaframe_active_workflow", JSON.stringify(sanitized));
        } else {
          localStorage.removeItem("metaframe_active_workflow");
        }
      } catch (e) {
        console.warn("Failed to persist workflow to localStorage:", e);
      }
    }, 1000);

    return () => clearTimeout(timer);
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
        setTerminalCwd(data.targetRepo);
        setFileTree(data.tree);
      })
      .catch((err) => console.error("Failed to connect to Bun server:", err));
  }, []);

  const handleSaveFileRef = useRef<() => void>(() => {});

  // Global shortcuts (Ctrl+S for Save, Ctrl+` for Terminal) with capture phase priority
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 1. Ctrl+S or Cmd+S to save active file
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S" || e.code === "KeyS")) {
        e.preventDefault();
        e.stopPropagation();
        handleSaveFileRef.current();
        return;
      }

      // 2. Ctrl+` for Integrated Terminal
      if ((e.ctrlKey || e.metaKey) && (e.key === "`" || e.key === "ñ" || e.code === "Backquote")) {
        e.preventDefault();
        setIsTerminalOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, []);

  // Monaco Editor did mount - register Ctrl+S command inside Monaco
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveFileRef.current();
    });
  };

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
    setEditorMode("code");
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

  // Open file in diff editor with interactive StagedDiff review
  const handleOpenDiff = (
    relPath: string,
    originalCode: string,
    generatedCode: string,
    summary?: { additions?: number; deletions?: number }
  ) => {
    setActiveFilePath(relPath);
    setDiffOriginal(originalCode);
    setDiffModified(generatedCode);
    setEditorContent(generatedCode);
    setEditorMode("diff");
    fetchBlastRadius(relPath);

    const origLines = new Set(originalCode.split("\n").map((l) => l.trim()));
    const modLines = new Set(generatedCode.split("\n").map((l) => l.trim()));
    let adds = 0;
    let dels = 0;
    for (const l of generatedCode.split("\n")) {
      if (l.trim() && !origLines.has(l.trim())) adds++;
    }
    for (const l of originalCode.split("\n")) {
      if (l.trim() && !modLines.has(l.trim())) dels++;
    }

    setStagedDiff({
      targetFile: relPath,
      originalCode,
      stagedCode: generatedCode,
      additions: summary?.additions ?? adds,
      deletions: summary?.deletions ?? dels,
    });

    const existing = openFiles.find((f) => f.path === relPath);
    if (!existing) {
      setOpenFiles((prev) => [...prev, { path: relPath, content: generatedCode }]);
    }
  };

  // Accept and commit staged diff to disk via Transactional Workspace Engine
  const handleAcceptStagedDiff = async () => {
    if (!stagedDiff) return;
    const { targetFile, stagedCode, additions, deletions } = stagedDiff;
    try {
      const res = await fetch(`${API_BASE}/file?path=${encodeURIComponent(targetFile)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: stagedCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Değişiklik kaydedilemedi.");
      }

      setEditorContent(stagedCode);
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === targetFile ? { ...f, content: stagedCode, isDirty: false } : f))
      );
      setEditorMode("code");
      setStagedDiff(null);

      const now = new Date().toTimeString().slice(0, 8);
      setActiveWorkflow((prev) =>
        prev
          ? {
              ...prev,
              logs: [
                ...prev.logs,
                {
                  time: now,
                  agent: "System",
                  text: `✔ Değişiklik onaylandı ve diske kaydedildi: ${targetFile} (+${additions}/-${deletions} satır)`,
                },
              ],
            }
          : null
      );
    } catch (err: any) {
      console.error("Accept diff error:", err);
      alert(`Değişiklik kaydedilemedi: ${err.message}`);
    }
  };

  // Reject staged diff and preserve original file
  const handleRejectStagedDiff = () => {
    if (!stagedDiff) return;
    const { targetFile, originalCode } = stagedDiff;
    setEditorContent(originalCode);
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === targetFile ? { ...f, content: originalCode, isDirty: false } : f))
    );
    setEditorMode("code");
    setStagedDiff(null);

    const now = new Date().toTimeString().slice(0, 8);
    setActiveWorkflow((prev) =>
      prev
        ? {
            ...prev,
            logs: [
              ...prev.logs,
              {
                time: now,
                agent: "System",
                text: `✖ Öneri kullanıcı tarafından reddedildi: ${targetFile} (orijinal kod korundu)`,
              },
            ],
          }
        : null
    );
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
    const currentPath = activeFilePathRef.current || activeFilePath;
    if (!currentPath) return;

    // Direct buffer from Monaco Editor if mounted (instant, zero lag)
    const contentToSave = editorRef.current ? editorRef.current.getValue() : (editorContentRef.current || editorContent);

    try {
      setSaveStatus("saving");
      const res = await fetch(`${API_BASE}/file?path=${encodeURIComponent(currentPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: contentToSave }),
      });
      const data = await res.json();
      if (data.success) {
        setEditorContent(contentToSave);
        editorContentRef.current = contentToSave;
        setOpenFiles((prev) =>
          prev.map((f) => (f.path === currentPath ? { ...f, content: contentToSave, isDirty: false } : f))
        );
        if (data.gateResult) {
          updateGateStatus(data.gateResult.gates);
        }
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2500);
      } else {
        setSaveStatus("error");
        console.error("Save file error:", data.error);
        alert(`Kayıt hatası: ${data.error || "Bilinmeyen hata"}`);
      }
    } catch (e: any) {
      setSaveStatus("error");
      console.error("Save file error:", e);
      alert(`Kayıt bağlantı hatası: ${e.message}`);
    }
  };
  handleSaveFileRef.current = handleSaveFile;

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
      if (g.gateName.includes("Code Health") || g.gateName.includes("Anti-Cheat")) map["Anti-Cheat"] = g.passed;
    });
    setGateResults((prev) => ({ ...prev, ...map }));
  };

  const isConversationalPrompt = (prompt: string): boolean => {
    const p = prompt.trim().toLowerCase();
    const starts = [
      "merhaba", "selam", "günaydın", "iyi günler", "hey", "nasılsın", "ne haber", "naber",
      "nasıl", "neden", "açıkla", "kim", "ne zaman", "anlat", "fikrin ne", "önerir misin",
      "hangisi daha iyi", "ne düşünüyorsun", "farkı ne", "yardım et", "bana bilgi ver",
      "what is", "how do", "why does", "explain", "who", "tell me"
    ];
    if (starts.some((s) => p.startsWith(s))) return true;
    if (p.endsWith("?") && !p.includes("yap") && !p.includes("ekle") && !p.includes("düzelt") && !p.includes("oluştur") && !p.includes("yaz")) return true;
    return false;
  };

  // Check if a prompt has code modification intent
  const isCodeModificationPrompt = (prompt: string): boolean => {
    const p = prompt.trim().toLowerCase();
    return (
      p.includes("değiştir") ||
      p.includes("güncelle") ||
      p.includes("ekle") ||
      p.includes("düzelt") ||
      p.includes("sil") ||
      p.includes("yap") ||
      p.includes("yaz") ||
      p.includes("oluştur") ||
      p.includes("koda uygula") ||
      p.includes("kodda değiştir") ||
      p.includes("modify") ||
      p.includes("update") ||
      p.includes("add") ||
      p.includes("fix") ||
      p.includes("change")
    );
  };

  // Apply AI-generated code directly to editor & workspace file
  const handleApplyCode = async (codeToApply: string, targetPath?: string): Promise<boolean> => {
    let targetFile = targetPath;
    const detectedComp = detectComponentNameFromCode(codeToApply);

    // 1. First 4 lines comment
    if (!targetFile) {
      const firstLines = codeToApply.split("\n").slice(0, 4).join("\n");
      const fileMatch = firstLines.match(/^(?:\/\/\s*|\/\*\s*)([a-zA-Z0-9_\-./\\]+\.(?:tsx?|jsx?|css|html|json))\b/m);
      if (fileMatch) {
        targetFile = fileMatch[1].replace(/\\/g, "/");
      }
    }

    // 2. Component name guard: If code declares a subcomponent, it can NEVER target App.tsx
    if (detectedComp && detectedComp !== "App") {
      if (!targetFile || targetFile === "src/App.tsx" || targetFile === "App.tsx") {
        targetFile = `src/components/${detectedComp}.tsx`;
      }
    }

    // 3. Fallback to activeFilePath only if safe
    if (!targetFile) {
      targetFile = activeFilePath || "src/App.tsx";
    }

    // 4. Absolute Guard: NEVER overwrite App.tsx with a non-App component!
    if ((targetFile === "src/App.tsx" || targetFile === "App.tsx") && detectedComp && detectedComp !== "App") {
      targetFile = `src/components/${detectedComp}.tsx`;
    }

    targetFile = targetFile.replace(/\\/g, "/");
    if (!targetFile.startsWith("src/") && !targetFile.includes("/")) {
      targetFile = `src/${targetFile}`;
    }

    try {
      const res = await fetch(`${API_BASE}/file?path=${encodeURIComponent(targetFile)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: codeToApply }),
      });
      const data = await res.json();

      if (data.success) {
        const finalSavedContent = data.content || codeToApply;
        const isSurgicallyMerged = data.content && data.content !== codeToApply;

        setActiveFilePath(targetFile);
        setEditorContent(finalSavedContent);
        setOpenFiles((prev) =>
          prev.some((f) => f.path === targetFile)
            ? prev.map((f) => (f.path === targetFile ? { ...f, content: finalSavedContent, isDirty: false } : f))
            : [...prev, { path: targetFile, content: finalSavedContent, isDirty: false }]
        );

        fetch(`${API_BASE}/workspace`)
          .then((r) => r.json())
          .then((d) => setFileTree(d.tree));
        fetchBlastRadius(targetFile);

        if (data.gateResult) {
          updateGateStatus(data.gateResult.gates);
        }

        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚡ **Kod Doğrudan Uygulandı!**\n\n\`${targetFile}\` dosyası diske kaydedildi ve Monaco editörüne yüklendi (${finalSavedContent.length} bayt).${isSurgicallyMerged ? " 🛡️ *(Cerrahi birleştirme: Mevcut kodlar ve importlar korunarak parça entegre edildi)*" : ""}`,
          },
        ]);

        return true;
      } else {
        alert(`Kod uygulanamadı: ${data.error || "Bilinmeyen hata"}`);
        return false;
      }
    } catch (err: any) {
      console.error("handleApplyCode error:", err);
      alert(`Kod uygulama hatası: ${err.message}`);
      return false;
    }
  };

  // Undo Last Transaction
  const handleUndoLastTxn = async () => {
    try {
      const jRes = await fetch(`${API_BASE}/transactions/journal`);
      const jData = await jRes.json();
      if (!jData.journal || jData.journal.length === 0) {
        alert("Geri alınabilecek işlem geçmişi bulunamadı.");
        return;
      }
      const lastUndoable = jData.journal.find((tx: any) => tx.canUndo);
      if (!lastUndoable) {
        alert("Geri alınabilecek aktif bir işlem kalmadı.");
        return;
      }

      const res = await fetch(`${API_BASE}/transactions/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txId: lastUndoable.txId }),
      });
      const data = await res.json();
      if (data.success) {
        if (activeFilePath && data.filesReverted?.includes(activeFilePath)) {
          handleOpenFile(activeFilePath);
        } else if (data.filesReverted?.[0]) {
          handleOpenFile(data.filesReverted[0]);
        }
        fetch(`${API_BASE}/workspace`)
          .then((r) => r.json())
          .then((d) => setFileTree(d.tree));

        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `↩ **İşlem Geri Alındı!**\n\n\`${lastUndoable.description}\` işlemi iptal edildi ve ${data.filesReverted?.join(", ")} dosyası önceki durumuna döndürüldü.`,
          },
        ]);
      } else {
        alert(`Geri alma hatası: ${data.error || "Bilinmeyen hata"}`);
      }
    } catch (err: any) {
      alert(`Geri alma hatası: ${err.message}`);
    }
  };

  // AI Copilot Chat Stream: Interactive Multi-Turn Conversation with Full Memory & Vision
  const handleChatSubmit = async (userPrompt: string, imagesToSend?: string[]) => {
    setIsWorking(true);
    setIsChatStreaming(true);
    setChatStreamingText("");

    const currentImages = imagesToSend || attachedImages;

    // Prepare conversation history (last 10 turns)
    const history = chatMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userPrompt,
          file: activeFilePath || "",
          contextFiles,
          images: currentImages,
          history,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Bağlantı hatası [${res.status}]`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullResponse = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.type === "chat_token") {
              fullResponse += data.token;
              setChatStreamingText(fullResponse);
            } else if (data.type === "chat_finish") {
              setIsChatStreaming(false);
              setIsWorking(false);
              const finalAns = data.response || fullResponse;
              setChatMessages((prev) => [
                ...prev,
                { role: "assistant", content: finalAns },
              ]);
              setChatStreamingText("");

              // If user prompt requested code modification and code was returned, auto-apply!
              const isMod = isCodeModificationPrompt(userPrompt);
              let target = data.detectedTargetFile;
              const code = data.extractedCode;
              const comp = code ? detectComponentNameFromCode(code) : null;

              if (!target && comp) {
                target = comp === "App" ? "src/App.tsx" : `src/components/${comp}.tsx`;
              }
              if (!target && activeFilePath && (activeFilePath !== "src/App.tsx" || comp === "App")) {
                target = activeFilePath;
              }
              if ((target === "src/App.tsx" || target === "App.tsx") && comp && comp !== "App") {
                target = `src/components/${comp}.tsx`;
              }

              if (isMod && code && target) {
                handleApplyCode(code, target);
              }
            } else if (data.type === "chat_error") {
              setIsChatStreaming(false);
              setIsWorking(false);
              setChatMessages((prev) => [
                ...prev,
                { role: "assistant", content: `❌ Sohbet Hatası: ${data.message}` },
              ]);
              setChatStreamingText("");
            }
          } catch (pe) {
            console.error("SSE parse error:", pe);
          }
        }
      }

      if (fullResponse && !chatMessages.some((m) => m.content === fullResponse)) {
        setIsChatStreaming(false);
        setIsWorking(false);
      }
    } catch (err: any) {
      console.error("Chat fetch stream error:", err);
      setIsChatStreaming(false);
      setIsWorking(false);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `❌ Sohbet Hatası: ${err.message}` },
      ]);
      setChatStreamingText("");
    }
  };

  // Vibe Coding Mode: Direct Single-Turn Code Generation (Zero Ceremony)
  const handleVibeSubmit = (userPrompt: string) => {
    const target = activeFilePath || "src/App.tsx";
    setVibeSession({
      prompt: userPrompt,
      targetFile: target,
      status: "generating",
      streamingCode: "",
      tokenCount: 0,
      logs: [
        {
          time: new Date().toTimeString().slice(0, 8),
          text: `⚡ Vibe Mode: Doğrudan kod sentezi başlatıldı ("${userPrompt}")`,
        },
      ],
    });

    try {
      const streamUrl = `${API_BASE}/vibe/stream?prompt=${encodeURIComponent(
        userPrompt
      )}&file=${encodeURIComponent(activeFilePath || "")}&contextFiles=${encodeURIComponent(
        JSON.stringify(contextFiles)
      )}`;

      const eventSource = new EventSource(streamUrl);
      currentEventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const now = new Date().toTimeString().slice(0, 8);

          if (data.type === "vibe_context") {
            setVibeSession((prev) =>
              prev
                ? {
                    ...prev,
                    targetFile: data.targetFile,
                    logs: [...prev.logs, { time: now, text: data.message }],
                  }
                : null
            );
          } else if (data.type === "vibe_token") {
            setVibeSession((prev) =>
              prev
                ? {
                    ...prev,
                    streamingCode: prev.streamingCode + data.token,
                    tokenCount: data.tokenCount,
                  }
                : null
            );
          } else if (data.type === "vibe_applied") {
            const { targetFile, code, bytes, durationMs } = data;
            setVibeSession((prev) =>
              prev
                ? {
                    ...prev,
                    status: "applied",
                    targetFile,
                    streamingCode: code,
                    bytes,
                    durationMs,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        text: `✔ Doğrudan diske ve editöre uygulandı (${bytes} bayt, ${Math.round(durationMs / 1000)}s)`,
                      },
                    ],
                  }
                : null
            );

            // Update Monaco editor content & open tab
            setActiveFilePath(targetFile);
            setEditorContent(code);
            if (reviewMode && data.originalCode && data.code && data.originalCode !== data.code) {
              handleOpenDiff(targetFile, data.originalCode, data.code, data.diffSummary);
            } else {
              setEditorMode("code");
            }
            setOpenFiles((prev) =>
              prev.some((f) => f.path === targetFile)
                ? prev.map((f) => (f.path === targetFile ? { ...f, content: code, isDirty: false } : f))
                : [...prev, { path: targetFile, content: code, isDirty: false }]
            );

            // Refresh file tree & blast radius
            fetch(`${API_BASE}/workspace`)
              .then((res) => res.json())
              .then((d) => setFileTree(d.tree));
            fetchBlastRadius(targetFile);

            setChatMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `⚡ **Vibe Coding Applied!**\n\n\`${targetFile}\` doğrudan güncellendi (${bytes} bytes, ~${Math.round(durationMs / 1000)}s).\n\nKod editöre yansıtıldı.`,
              },
            ]);
          } else if (data.type === "vibe_finish") {
            eventSource.close();
            currentEventSourceRef.current = null;
            setIsWorking(false);
          } else if (data.type === "vibe_error") {
            eventSource.close();
            currentEventSourceRef.current = null;
            setIsWorking(false);
            setVibeSession((prev) =>
              prev
                ? {
                    ...prev,
                    status: "error",
                    error: data.message,
                    logs: [...prev.logs, { time: now, text: `✖ Hata: ${data.message}` }],
                  }
                : null
            );
          }
        } catch (err) {
          console.error("Vibe stream parse error:", err);
        }
      };

      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CONNECTING) return;
        eventSource.close();
        currentEventSourceRef.current = null;
        setIsWorking(false);
        setVibeSession((prev) =>
          prev
            ? {
                ...prev,
                status: "error",
                error: "Akış bağlantısı kesildi.",
                logs: [...prev.logs, { time: new Date().toTimeString().slice(0, 8), text: "✖ Bağlantı kesildi" }],
              }
            : null
        );
      };
    } catch (e: any) {
      currentEventSourceRef.current = null;
      setIsWorking(false);
      console.error("Failed to connect to vibe stream:", e);
    }
  };

  // Handle Copilot Plan Execution with Real-Time SSE Stream
  const handleCopilotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userPrompt = copilotPrompt.trim() || (attachedImages.length > 0 ? "Bu görseldeki tasarımı analiz et ve ilgili bileşeni kodla." : "");
    if (!userPrompt || isWorking) return;

    const currentImages = [...attachedImages];
    setCopilotPrompt("");
    setAttachedImages([]);
    setChatMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userPrompt,
        images: currentImages.length > 0 ? currentImages : undefined,
      },
    ]);
    setIsWorking(true);

    const isQuestion = isConversationalPrompt(userPrompt);

    if (studioMode === "chat" || isQuestion || currentImages.length > 0) {
      handleChatSubmit(userPrompt, currentImages);
      return;
    }

    if (studioMode === "vibe") {
      handleVibeSubmit(userPrompt);
      return;
    }

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
                    stepTokenCount: 0,
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
            const addedTokens = data.token ? Math.max(1, Math.ceil(data.token.length / 4)) : 0;
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    streamingCode: (prev.streamingCode || "") + (data.token || ""),
                    tokenCount: (prev.tokenCount || 0) + addedTokens,
                    stepTokenCount: (prev.stepTokenCount || 0) + addedTokens,
                  }
                : null
            );
          } else if (data.type === "code_step_done") {
            if (reviewMode && data.originalCode && data.generatedCode && data.originalCode !== data.generatedCode) {
              handleOpenDiff(data.targetFile, data.originalCode, data.generatedCode, data.diffSummary);
            }
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Gemma",
                        text: `Written to disk: ${data.targetFile} (${data.codeLength} bytes${data.diffSummary ? `, +${data.diffSummary.additions}/-${data.diffSummary.deletions} satır` : ""}).`,
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
          } else if (data.type === "code_error") {
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    currentPhase: 5,
                    error: Array.isArray(data.errors) ? data.errors.join("; ") : "Kod üretimi hatayla sonuçlandı",
                    phaseMessage: `Kod sentezinde hata oluştu. Kalite kapılarına geçiliyor...`,
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "Gemma",
                        text: `✖ Kod sentez hatası: ${Array.isArray(data.errors) ? data.errors.join(" | ") : data.errors}`,
                      },
                    ],
                  }
                : null
            );
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
            const isSuccess = data.result?.success === true;
            setActiveWorkflow((prev) =>
              prev
                ? {
                    ...prev,
                    status: isSuccess ? "completed" : "error",
                    phaseMessage: isSuccess
                      ? "Workflow Completed Successfully! All 6 gates verified."
                      : "Quality Gates FAILED! Review compiler and gate errors.",
                    logs: [
                      ...prev.logs,
                      {
                        time: now,
                        agent: "System",
                        text: isSuccess
                          ? "Autonomous engineering cycle complete! All artifacts verified."
                          : "Workflow finished with QUALITY GATE FAILURES! Verification did not pass.",
                      },
                    ],
                  }
                : null
            );
            eventSource.close();
            currentEventSourceRef.current = null;
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
            currentEventSourceRef.current = null;
            setIsWorking(false);
          }
        } catch (parseErr) {
          console.error("Error parsing SSE stream event:", parseErr);
        }
      };

      eventSource.onerror = (err) => {
        // If the browser is attempting an automatic reconnect (readyState === 0), do not abort!
        if (eventSource.readyState === EventSource.CONNECTING) {
          console.warn("EventSource reconnecting...");
          return;
        }

        console.error("EventSource stream error:", err);
        eventSource.close();
        currentEventSourceRef.current = null;
        setIsWorking(false);
        setActiveWorkflow((prev) =>
          prev && prev.status === "running"
            ? {
                ...prev,
                status: "error",
                error: "Akış bağlantısı kesildi veya zaman aşımına uğradı.",
                phaseMessage: "İşlem kesintiye uğradı.",
                logs: [
                  ...prev.logs,
                  {
                    time: new Date().toTimeString().slice(0, 8),
                    agent: "System",
                    text: "⚠ Sunucu bağlantısı kesildi veya zaman aşımına uğradı.",
                  },
                ],
              }
            : prev
        );
      };
    } catch (err: any) {
      console.error("Failed to start SSE stream:", err);
      currentEventSourceRef.current = null;
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
    const isContext = contextFiles.includes(node.path);
    return (
      <div
        key={node.path}
        className={`tree-node ${isActive ? "active" : ""} ${isContext ? "in-context" : ""}`}
        style={{
          paddingLeft: `${level * 12 + 18}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingRight: "6px",
        }}
        onClick={() => handleOpenFile(node.path)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis" }}>
          <FileCode size={13} color={node.name.endsWith(".tsx") ? "#38bdf8" : "#94a3b8"} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
        </div>
        <button
          type="button"
          className="tree-context-pin"
          onClick={(e) => {
            e.stopPropagation();
            toggleContextFile(node.path);
          }}
          title={isContext ? "Bağlamdan (Context) çıkar" : "AI Bağlamına (Context) ekle"}
          style={{
            background: isContext ? "rgba(16, 185, 129, 0.2)" : "transparent",
            border: isContext ? "1px solid rgba(16, 185, 129, 0.4)" : "none",
            borderRadius: "3px",
            padding: "2px 4px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            opacity: isContext ? 1 : 0.4,
            transition: "all 0.15s ease",
          }}
        >
          <Paperclip size={11} color={isContext ? "#10b981" : "var(--text-muted)"} />
        </button>
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

        {/* Cyber Operation Mode Switcher */}
        <div className="mode-selector-dock">
          {(Object.values(STUDIO_MODES) as ModeConfig[]).map((m) => {
            const Icon =
              m.id === "vibe"
                ? Headphones
                : m.id === "engineering"
                ? Shield
                : m.id === "mimar"
                ? Compass
                : m.id === "autonomous"
                ? Bot
                : Bug;
            const isActive = studioMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                className={`mode-pill-btn ${isActive ? "active" : ""}`}
                style={{
                  borderColor: isActive ? m.color : "transparent",
                  color: isActive ? "#fff" : "var(--text-muted)",
                  background: isActive ? m.glow : "transparent",
                  boxShadow: isActive ? `0 0 10px ${m.glow}` : "none",
                }}
                onClick={() => handleSelectMode(m.id)}
                title={`${m.name} Modu: ${m.tagline}`}
              >
                <Icon size={12} color={isActive ? m.color : "var(--text-dim)"} />
                <span>{m.name}</span>
              </button>
            );
          })}
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
          <button
            className="btn-hud"
            onClick={handleUndoLastTxn}
            title="Son Kod Değişikliğini Geri Al (Undo)"
            style={{ color: "#ec4899", borderColor: "rgba(236, 72, 153, 0.3)" }}
          >
            <RotateCcw size={13} color="#ec4899" />
            <span>Geri Al</span>
          </button>
          <button
            className={`btn-hud ${isTerminalOpen ? "active" : ""}`}
            onClick={() => setIsTerminalOpen((prev) => !prev)}
            title="Toggle Integrated Terminal (Ctrl+`)"
          >
            <TerminalIcon size={13} color="var(--accent)" />
            <span>Terminal</span>
          </button>
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
      <div className={`main-workspace ${isResizing ? `resizing-active resizing-${isResizing}` : ""}`}>
        {/* Left Sidebar: File Tree & Radar */}
        <aside ref={sidebarPanelRef} className="sidebar" style={{ width: sidebarWidth }}>
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

        {/* Resizer: Sidebar <-> Editor */}
        <div
          className={`gutter-handle gutter-col ${isResizing === "sidebar" ? "active" : ""}`}
          onMouseDown={handleSidebarMouseDown}
          title="Drag to resize Explorer"
        />

        {/* Center: Monaco Code Editor */}
        <main ref={editorPanelRef} className="editor-panel">
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
            {activeFilePath && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, paddingRight: 8 }}>
                <button
                  type="button"
                  onClick={() => toggleContextFile(activeFilePath)}
                  title={contextFiles.includes(activeFilePath) ? "Dosyayı AI bağlamından (Context) çıkar" : "Bu dosyayı AI bağlamına (Context) ekle"}
                  style={{
                    background: contextFiles.includes(activeFilePath) ? "rgba(16, 185, 129, 0.18)" : "rgba(255, 255, 255, 0.05)",
                    color: contextFiles.includes(activeFilePath) ? "#10b981" : "var(--text-muted)",
                    border: contextFiles.includes(activeFilePath) ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(255, 255, 255, 0.1)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transition: "all 0.2s ease",
                  }}
                >
                  <Paperclip size={11} color={contextFiles.includes(activeFilePath) ? "#10b981" : "var(--text-muted)"} />
                  <span>{contextFiles.includes(activeFilePath) ? "Bağlamda ✓" : "Context'e Ekle"}</span>
                </button>
                <button
                  onClick={() => setEditorMode("code")}
                  style={{
                    background: editorMode === "code" ? "var(--accent)" : "rgba(255, 255, 255, 0.05)",
                    color: editorMode === "code" ? "#000" : "var(--text-muted)",
                    border: "none",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  Code
                </button>
                <button
                  onClick={() => setEditorMode("diff")}
                  style={{
                    background: editorMode === "diff" ? "var(--accent)" : "rgba(255, 255, 255, 0.05)",
                    color: editorMode === "diff" ? "#000" : "var(--text-muted)",
                    border: "none",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  Diff Inspector
                </button>
              </div>
            )}
          </div>

          <div className="editor-wrapper">
            {stagedDiff && (
              <div className="diff-review-bar">
                <div className="diff-review-info">
                  <Sparkles size={14} color="#a855f7" />
                  <span className="diff-file-badge">{stagedDiff.targetFile}</span>
                  <span className="diff-stat-pill add">+{stagedDiff.additions} satır</span>
                  <span className="diff-stat-pill del">-{stagedDiff.deletions} satır</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                    Satır bazlı değişiklik önerisi
                  </span>
                </div>
                <div className="diff-review-actions">
                  <button className="btn-diff-reject" onClick={handleRejectStagedDiff} title="Öneriyi reddet ve orijinal dosyayı koru">
                    <X size={12} />
                    <span>Reddet (Discard)</span>
                  </button>
                  <button className="btn-diff-accept" onClick={handleAcceptStagedDiff} title="Değişiklikleri onayla ve diske kaydet">
                    <Check size={12} />
                    <span>Değişikliği Onayla & Kaydet (Accept)</span>
                  </button>
                </div>
              </div>
            )}
            {activeFilePath ? (
              editorMode === "diff" ? (
                <DiffEditor
                  height="100%"
                  theme="metaframe-cyber"
                  original={diffOriginal}
                  modified={diffModified || editorContent}
                  beforeMount={handleEditorWillMount}
                  options={{
                    fontFamily: "'JetBrains Mono', Consolas, monospace",
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    automaticLayout: true,
                    readOnly: true,
                    renderSideBySide: true,
                  }}
                />
              ) : (
                <Editor
                  height="100%"
                  theme="metaframe-cyber"
                  path={activeFilePath}
                  value={editorContent}
                  beforeMount={handleEditorWillMount}
                  onMount={handleEditorDidMount}
                  onChange={(val) => {
                    const nextVal = val || "";
                    setEditorContent(nextVal);
                    editorContentRef.current = nextVal;
                    setOpenFiles((prev) =>
                      prev.map((f) => (f.path === activeFilePath ? { ...f, content: nextVal, isDirty: true } : f))
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
              )
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

          {/* Integrated Terminal Panel */}
          {isTerminalOpen && (
            <>
              {/* Resizer: Editor <-> Terminal */}
              <div
                className={`gutter-handle gutter-row ${isResizing === "terminal" ? "active" : ""}`}
                onMouseDown={handleTerminalMouseDown}
                title="Drag to resize Terminal (↕)"
              >
                <div className="gutter-row-grip" />
              </div>
              <div ref={terminalPanelRef} className="terminal-panel" style={{ height: terminalHeight }}>
              <div className="terminal-dock-header">
                <div className="terminal-dock-tabs">
                  <div className="terminal-dock-tab active">
                    <TerminalIcon size={12} color="var(--accent)" />
                    <span>TERMINAL</span>
                    <span className="terminal-status-dot" />
                  </div>
                  <div className="terminal-cwd-pill" title={terminalCwd || targetRepo}>
                    <span>{terminalCwd || targetRepo}</span>
                  </div>
                </div>

                {/* Quick command pills */}
                <div className="terminal-quick-actions">
                  <button className="quick-cmd-btn" onClick={() => handleExecuteTerminal("git status")}>git status</button>
                  <button className="quick-cmd-btn" onClick={() => handleExecuteTerminal("bun test")}>bun test</button>
                  <button className="quick-cmd-btn" onClick={() => handleExecuteTerminal("dir")}>dir</button>
                </div>

                <div className="terminal-dock-actions">
                  <button
                    className="dock-icon-btn"
                    title={terminalHeight > 300 ? "Collapse Height" : "Expand Height"}
                    onClick={() => setTerminalHeight((prev) => (prev > 300 ? 220 : 400))}
                  >
                    {terminalHeight > 300 ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  </button>
                  <button
                    className="dock-icon-btn"
                    title="Clear Terminal (cls)"
                    onClick={() => setTerminalHistory([])}
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    className="dock-icon-btn"
                    title="Close Terminal"
                    onClick={() => setIsTerminalOpen(false)}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>

              {/* Terminal Logs & Output */}
              <div
                className="terminal-dock-body"
                onClick={() => terminalInputRef.current?.focus()}
              >
                {terminalHistory.map((item) => (
                  <div key={item.id} className="terminal-line-entry">
                    {item.command && (
                      <div className="terminal-cmd-row">
                        <span className="terminal-ps-prompt">PS</span>
                        <span className="terminal-prompt-path">
                          {((item.cwd || "").split(/[\\/]/).pop() || "repo")}&gt;
                        </span>
                        <span className="terminal-cmd-text">{item.command}</span>
                        <span className="terminal-time-tag">{item.time}</span>
                      </div>
                    )}
                    {item.stdout && (
                      <pre className="terminal-stdout">{item.stdout}</pre>
                    )}
                    {item.stderr && (
                      <pre className="terminal-stderr">{item.stderr}</pre>
                    )}
                  </div>
                ))}
                {isExecutingCmd && (
                  <div className="terminal-running-indicator">
                    <span className="terminal-spinner">⚡</span> Running command...
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>

              {/* Terminal Input Line */}
              <div className="terminal-dock-input-bar">
                <span className="terminal-ps-prompt">PS</span>
                <span className="terminal-prompt-path">
                  {((terminalCwd || targetRepo || "").split(/[\\/]/).pop() || "repo")}&gt;
                </span>
                <input
                  ref={terminalInputRef}
                  type="text"
                  className="terminal-dock-input"
                  placeholder="Enter shell command (e.g. git status, bun test, dir)..."
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={handleTerminalKeyDown}
                  disabled={isExecutingCmd}
                  autoFocus
                />
                <button
                  className="terminal-send-btn"
                  onClick={() => handleExecuteTerminal()}
                  disabled={isExecutingCmd || !terminalInput.trim()}
                  title="Run (Enter)"
                >
                  <CornerDownLeft size={12} />
                </button>
              </div>
            </div>
          </>
        )}

          <footer className="editor-footer">
            <div>{activeFilePath || targetRepo || "Ready"}</div>
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              {activeFilePath && (
                <>
                  <span>UTF-8</span>
                  <span>{activeFilePath.endsWith(".tsx") ? "TypeScript React" : "TypeScript"}</span>
                  <span
                    style={{
                      cursor: "pointer",
                      color:
                        saveStatus === "saved"
                          ? "#10b981"
                          : saveStatus === "saving"
                          ? "#f59e0b"
                          : saveStatus === "error"
                          ? "#ef4444"
                          : "var(--accent)",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.2s ease",
                    }}
                    onClick={handleSaveFile}
                    title="Kaydet ve Doğrulama Kapılarını Çalıştır (Ctrl+S)"
                  >
                    {saveStatus === "saving"
                      ? "⏳ Kaydediliyor..."
                      : saveStatus === "saved"
                      ? "✔ Kaydedildi (Ctrl+S)"
                      : saveStatus === "error"
                      ? "✖ Hata!"
                      : "Save & Test (Ctrl+S)"}
                  </span>
                </>
              )}
              <span
                style={{
                  cursor: "pointer",
                  color: isTerminalOpen ? "var(--accent)" : "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontWeight: 600,
                }}
                onClick={() => setIsTerminalOpen((prev) => !prev)}
                title="Toggle Terminal (Ctrl+`)"
              >
                <TerminalIcon size={11} />
                <span>Terminal (Ctrl+`)</span>
              </span>
            </div>
          </footer>
        </main>

        {/* Resizer: Editor <-> Copilot */}
        <div
          className={`gutter-handle gutter-col ${isResizing === "copilot" ? "active" : ""}`}
          onMouseDown={handleCopilotMouseDown}
          title="Drag to resize Copilot"
        />

        {/* Right: MetaFrame Agent Copilot */}
        <aside ref={copilotPanelRef} className="copilot-panel" style={{ width: copilotWidth }}>
          <div className="copilot-header">
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <Sparkles size={16} color="var(--accent)" />
              <span>Orchestrator Copilot</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: "4px",
                  color: STUDIO_MODES[studioMode].color,
                  background: STUDIO_MODES[studioMode].glow,
                  border: `1px solid ${STUDIO_MODES[studioMode].color}`,
                }}
              >
                {STUDIO_MODES[studioMode].badge}
              </span>
              <button
                type="button"
                onClick={handleClearAll}
                title="Sohbet geçmişini ve aktif workflow'u tamamen temizle (Yeni Oturum)"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: "4px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <Trash2 size={10} />
                <span>Temizle</span>
              </button>
            </div>
          </div>

          <div className="copilot-body">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`agent-bubble ${msg.role}`}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: msg.role === "user" ? "var(--accent)" : "#10b981", marginBottom: 6 }}>
                  {msg.role === "user" ? "YOU" : "QWEN3 8B · SOHBET"}
                </div>
                {msg.role === "user" ? (
                  <div>
                    {msg.images && msg.images.length > 0 && (
                      <div className="chat-images-grid">
                        {msg.images.map((img, i) => (
                          <img
                            key={i}
                            src={img}
                            alt="Uploaded screenshot"
                            className="chat-message-image"
                            onClick={() => window.open(img, "_blank")}
                            title="Büyük boyutta açmak için tıkla"
                          />
                        ))}
                      </div>
                    )}
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "12.5px" }}>{msg.content}</div>
                  </div>
                ) : (
                  <MarkdownRenderer content={msg.content} onApplyCode={handleApplyCode} />
                )}
              </div>
            ))}

            {/* Live Streaming Chat Response Bubble */}
            {isChatStreaming && (
              <div className="agent-bubble assistant streaming" style={{ borderLeft: "3px solid #10b981", background: "rgba(16, 185, 129, 0.08)" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#10b981", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="vibe-pulse-indicator" style={{ background: "#10b981" }} />
                  <span>QWEN3 8B · YAZIYOR...</span>
                </div>
                <MarkdownRenderer content={chatStreamingText || "Düşünüyor..."} onApplyCode={handleApplyCode} />
              </div>
            )}

            {/* Vibe Mode Direct Synthesizer Panel */}
            {studioMode === "vibe" && vibeSession && (
              <div className="vibe-session-panel">
                <div className="vibe-header">
                  <div className="vibe-title">
                    <span className="vibe-pulse-indicator" />
                    <span>⚡ Vibe Coding · Doğrudan Kod Sentezi</span>
                  </div>
                  <div className="vibe-target-pill">
                    <span>🎯 {vibeSession.targetFile}</span>
                  </div>
                </div>

                <div style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{vibeSession.status === "generating" ? "⚡ Groq LPU ile canlı kod akışı (~500 tok/s)..." : vibeSession.status === "applied" ? "✔ Kod doğrudan diske ve editöre uygulandı" : "Hazır"}</span>
                  {vibeSession.tokenCount > 0 && (
                    <span style={{ fontFamily: "JetBrains Mono", color: "#ec4899", fontWeight: 700 }}>
                      {vibeSession.tokenCount} tokens {vibeSession.durationMs ? `(${Math.round(vibeSession.durationMs / 1000)}s)` : ""}
                    </span>
                  )}
                </div>

                {vibeSession.streamingCode && (
                  <div className="vibe-stream-box">
                    {vibeSession.streamingCode}
                  </div>
                )}

                <div className="vibe-actions-row">
                  <span className="vibe-stats">
                    {vibeSession.bytes ? `${vibeSession.bytes} bayt yazıldı` : "Zero-Ceremony: PRD & Plan atlandı"}
                  </span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {vibeSession.status === "applied" && (
                      <button
                        type="button"
                        className="vibe-btn"
                        onClick={() => handleOpenFile(vibeSession.targetFile)}
                      >
                        <FileCode size={11} />
                        <span>Editörde Aç</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="vibe-btn"
                      style={{ borderColor: "rgba(255,255,255,0.15)", color: "var(--text-muted)" }}
                      onClick={() => setVibeSession(null)}
                    >
                      <RotateCcw size={10} />
                      <span>Kapat</span>
                    </button>
                  </div>
                </div>

                {vibeSession.logs && vibeSession.logs.length > 0 && (
                  <div style={{ fontSize: "10px", color: "var(--text-dim)", display: "flex", flexDirection: "column", gap: 2, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>
                    {vibeSession.logs.map((l, i) => (
                      <div key={i}>[{l.time}] {l.text}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Live Visual Workflow Execution Stepper (Formal Modes) */}
            {studioMode !== "vibe" && activeWorkflow && (
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
                  <div className={`timeline-step ${activeWorkflow.currentPhase === 5 && activeWorkflow.status === "running" ? "active" : activeWorkflow.execution ? "completed" : activeWorkflow.status === "error" || activeWorkflow.status === "interrupted" ? "error" : ""}`}>
                    <div className="step-header accordion-toggle" onClick={() => toggleStepExpand(5)}>
                      <div className="step-title">
                        {activeWorkflow.execution?.overallSuccess ? (
                          <CheckCircle size={14} color="#10b981" />
                        ) : activeWorkflow.currentPhase === 5 && activeWorkflow.status === "running" ? (
                          <span className="pulse-dot" />
                        ) : activeWorkflow.status === "error" || activeWorkflow.status === "interrupted" ? (
                          <AlertTriangle size={14} color="#f87171" />
                        ) : (
                          <Cpu size={14} color="var(--text-dim)" />
                        )}
                        <span>5. Groq LPU · Live Code Generation (qwen3.8-27b)</span>
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
                              const hasOriginal = st.originalCode !== undefined && st.originalCode !== null;
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 6,
                                    margin: "4px 0",
                                    background: "rgba(255, 255, 255, 0.02)",
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    border: "1px solid rgba(255, 255, 255, 0.05)",
                                  }}
                                >
                                  <span
                                    className="file-link-pill"
                                    onClick={() => {
                                      if (file) {
                                        handleOpenFile(file);
                                        setEditorMode("code");
                                      }
                                    }}
                                    title="Open file in standard editor"
                                  >
                                    <FileCode size={11} />
                                    <span>{file ? file.split(/[\\/]/).pop() : "file"}</span>
                                  </span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    {hasOriginal && (
                                      <button
                                        onClick={() => handleOpenDiff(file, st.originalCode || "", st.generatedCode || "")}
                                        style={{
                                          background: "rgba(56, 189, 248, 0.15)",
                                          border: "1px solid rgba(56, 189, 248, 0.3)",
                                          color: "#38bdf8",
                                          fontSize: "10px",
                                          fontWeight: 700,
                                          padding: "2px 6px",
                                          borderRadius: "4px",
                                          cursor: "pointer",
                                        }}
                                        title="Inspect Before vs After Diff"
                                      >
                                        Diff View
                                      </button>
                                    )}
                                    <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                                      {st.codeLength || 0} bytes
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : activeWorkflow.currentPhase === 5 && activeWorkflow.status === "running" ? (
                          <div>
                            <div style={{ fontSize: "11px", color: "#38bdf8", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                              <span className="pulse-dot green" />
                              <span>
                                {activeWorkflow.currentCodeStep
                                  ? `Live Code Synthesis: ${activeWorkflow.currentCodeStep.targetFile} [${activeWorkflow.currentCodeStep.index}/${activeWorkflow.currentCodeStep.total}]`
                                  : "Groq Cloud (500+ tok/s) synthesizing code..."}
                              </span>
                            </div>

                            {/* Live Monospaced Terminal with real-time autoscroll */}
                            <div className="streaming-code-terminal">
                              <div className="terminal-header">
                                <span style={{ color: "#94a3b8" }}>
                                  {activeWorkflow.currentCodeStep?.targetFile || "source_stream.tsx"}
                                </span>
                                <span style={{ color: "#38bdf8", fontWeight: 700 }}>
                                  {activeWorkflow.stepTokenCount || 0} tokens
                                </span>
                              </div>
                              <div
                                className="terminal-body"
                                ref={terminalBodyRef}
                              >
                                {activeWorkflow.streamingCode || "// Establishing GPU token stream...\n// Preparing syntax AST..."}
                                <span className="terminal-cursor">▋</span>
                              </div>
                            </div>
                          </div>
                        ) : activeWorkflow.status === "error" || activeWorkflow.status === "interrupted" ? (
                          <div style={{ color: "#f87171", fontSize: "11px", background: "rgba(239, 68, 68, 0.08)", padding: "10px 12px", borderRadius: "6px", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                            <div style={{ fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                              <AlertTriangle size={12} color="#f87171" />
                              <span>Kod sentezi tamamlanamadı veya kesintiye uğradı</span>
                            </div>
                            <div style={{ color: "var(--text-dim)", fontSize: "10px" }}>
                              {activeWorkflow.currentCodeStep ? `Dosya: ${activeWorkflow.currentCodeStep.targetFile}` : ""} ({activeWorkflow.stepTokenCount || activeWorkflow.tokenCount || 0} token)
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                        {activeWorkflow.logs?.length || 0} events
                      </span>
                      {activeWorkflow.logs && activeWorkflow.logs.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearTelemetry}
                          title="Telemetri loglarını temizle"
                          style={{
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            color: "var(--text-muted)",
                            fontSize: "10px",
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Trash2 size={10} />
                          <span>Temizle</span>
                        </button>
                      )}
                    </div>
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
            {/* Active Mode Banner */}
            <div
              className="copilot-mode-banner"
              style={{
                borderColor: STUDIO_MODES[studioMode].color,
                background: STUDIO_MODES[studioMode].glow,
              }}
            >
              <div className="copilot-mode-info">
                <div className="copilot-mode-title" style={{ color: STUDIO_MODES[studioMode].color }}>
                  <span>{STUDIO_MODES[studioMode].name} Modu</span>
                  <span className="badge-tag" style={{ color: STUDIO_MODES[studioMode].color, borderColor: STUDIO_MODES[studioMode].color }}>
                    {STUDIO_MODES[studioMode].badge}
                  </span>
                </div>
                <div className="copilot-mode-desc">{STUDIO_MODES[studioMode].tagline}</div>
              </div>
            </div>

            {/* Mode Quick Suggestions */}
            <div className="mode-suggestions-row">
              {STUDIO_MODES[studioMode].suggestions.map((sug, sIdx) => (
                <button
                  key={sIdx}
                  type="button"
                  className="mode-suggestion-chip"
                  onClick={() => setCopilotPrompt(sug)}
                  title="Click to fill prompt"
                >
                  ⚡ {sug}
                </button>
              ))}
            </div>

            {studioMode === "vibe" ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#ec4899", display: "flex", alignItems: "center", gap: 5 }}>
                  <span className="vibe-pulse-indicator" />
                  <span>Direct Code Generation: PRD/ADR Yok · Hızlı Sentez</span>
                </span>
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: "10.5px", color: reviewMode ? "#f472b6" : "var(--text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={reviewMode}
                    onChange={(e) => setReviewMode(e.target.checked)}
                    style={{ accentColor: "#ec4899" }}
                  />
                  <span>Diff İncele</span>
                </label>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "11px", color: autoCodeWrite ? "#34d399" : "var(--text-muted)" }}>
                    <input
                      type="checkbox"
                      checked={autoCodeWrite}
                      onChange={(e) => setAutoCodeWrite(e.target.checked)}
                      style={{ accentColor: STUDIO_MODES[studioMode].color }}
                    />
                    <span style={{ fontWeight: 600 }}>Auto-Write Code</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "11px", color: reviewMode ? "#a855f7" : "var(--text-muted)" }} title="Model kod ürettiğinde diske yazmadan önce Monaco Diff Editörde satır satır gösterip onay ister">
                    <input
                      type="checkbox"
                      checked={reviewMode}
                      onChange={(e) => setReviewMode(e.target.checked)}
                      style={{ accentColor: "#a855f7" }}
                    />
                    <span style={{ fontWeight: 600 }}>Satır Bazlı İnceleme (Review & Diff)</span>
                  </label>
                </div>
                <span style={{ fontSize: "10px", color: autoCodeWrite ? "#38bdf8" : "var(--text-dim)" }}>
                  {autoCodeWrite ? "⚡ Auto-Modify Active" : "📋 Plan Only"}
                </span>
              </div>
            )}
            {/* AI Context Files Bar */}
            <div className="copilot-context-bar">
              <div className="context-bar-header">
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Paperclip size={12} color="#10b981" />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#10b981" }}>AI Bağlamı (Context):</span>
                  <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                    {contextFiles.length > 0 ? `${contextFiles.length} dosya yüklü` : "Dosya eklenmedi"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setContextSearchQuery("");
                      setShowAddContextModal(true);
                    }}
                    className="btn-context-add"
                    title="Projeden bağlama dosya ekle veya @ yazarak ara"
                  >
                    <Plus size={11} />
                    <span>Dosya Ekle (@)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="btn-context-add"
                    title="Görsel / Ekran Görüntüsü Yükle (veya yapıştır Ctrl+V)"
                  >
                    <ImageIcon size={11} />
                    <span>Resim Ekle</span>
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageFileSelect}
                    style={{ display: "none" }}
                  />
                  {contextFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setContextFiles([])}
                      className="btn-context-clear"
                      title="Tüm bağlam dosyalarını temizle"
                    >
                      Temizle
                    </button>
                  )}
                </div>
              </div>

              {contextFiles.length > 0 && (
                <div className="context-chips-container">
                  {contextFiles.map((filePath) => {
                    const fileName = filePath.split(/[\\/]/).pop() || filePath;
                    return (
                      <div key={filePath} className="context-chip" title={filePath}>
                        <FileCode size={11} color="#38bdf8" />
                        <span className="context-chip-name">{fileName}</span>
                        <span
                          className="context-chip-remove"
                          onClick={() => removeContextFile(filePath)}
                          title="Bağlamdan çıkar"
                        >
                          <X size={10} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Attached Vision Images Preview */}
            {attachedImages.length > 0 && (
              <div className="attached-images-preview-row">
                {attachedImages.map((img, idx) => (
                  <div key={idx} className="attached-image-chip" title="Eklenen görsel">
                    <img src={img} alt="Attached thumbnail" className="attached-image-thumb" />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="attached-image-remove"
                      title="Görseli kaldır"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <span style={{ fontSize: "10.5px", color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                  <ImageIcon size={11} />
                  <span>{attachedImages.length} görsel eklendi (Gemma4 Vision aktif)</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAttachedImages([])}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: "10px",
                    marginLeft: "auto",
                    textDecoration: "underline",
                  }}
                >
                  Tümünü Kaldır
                </button>
              </div>
            )}

            <div style={{ position: "relative" }}>
              {atMentionQuery !== null && atMentionMatches.length > 0 && (
                <div className="at-mention-popup">
                  <div className="at-mention-header">
                    <span>📎 Bağlama Ekle (@{atMentionQuery})</span>
                    <span style={{ fontSize: "9px", opacity: 0.7 }}>Tab veya Tıkla</span>
                  </div>
                  {atMentionMatches.map((filePath) => (
                    <div
                      key={filePath}
                      className="at-mention-item"
                      onClick={() => handleSelectAtMention(filePath)}
                    >
                      <FileCode size={12} color="#38bdf8" />
                      <span>{filePath.split("/").pop()}</span>
                      <span className="file-badge">{filePath}</span>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                className="copilot-textarea"
                placeholder={`${STUDIO_MODES[studioMode].name} Modu: ${
                  studioMode === "chat"
                    ? "Proje hakkında bir soru sor, mimari tartış veya kod analizi iste (örn: Navbar bileşeni nasıl çalışıyor?)..."
                    : studioMode === "vibe"
                    ? "Kodu tarif et, doğrudan yazsın (örn: Hero bölümüne neon gradient ve animasyonlu butonlar ekle)..."
                    : studioMode === "engineering"
                    ? "6-Gate uyumlu mimari görev veya tip güvenli refactor tarif et..."
                    : studioMode === "mimar"
                    ? "Sistem PRD, mimari karar (ADR) veya veri akışı tasarımı iste..."
                    : studioMode === "autonomous"
                    ? "Otonom uçtan uca özellik geliştirme ve self-heal talimatı ver..."
                    : "Hata ayıklama, bozuk importlar veya AST çağrı analizini başlat..."
                }`}
                value={copilotPrompt}
                onChange={handlePromptChange}
                onPaste={handlePaste}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (atMentionQuery !== null && atMentionMatches.length > 0) {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      handleSelectAtMention(atMentionMatches[0]);
                      return;
                    }
                    if (e.key === "Escape") {
                      setAtMentionQuery(null);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleCopilotSubmit(e);
                  }
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>Enter to Send · Shift+Enter for newline</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="btn-hud"
                  style={{
                    padding: "4px 8px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    cursor: "pointer",
                    fontSize: "11px",
                  }}
                  title="Sohbet ve aktif iş akışını tamamen temizle (Yeni Oturum)"
                >
                  <Trash2 size={11} />
                  <span>Temizle</span>
                </button>
                {isWorking && (
                  <button
                    type="button"
                    onClick={handleAbortExecution}
                    className="btn-hud"
                    style={{
                      padding: "4px 10px",
                      background: "rgba(239, 68, 68, 0.15)",
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      color: "#f87171",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      cursor: "pointer",
                    }}
                    title="Devam eden işlemi hemen durdur"
                  >
                    <Square size={11} fill="#f87171" />
                    <span>Durdur</span>
                  </button>
                )}
                <button
                  type="submit"
                  className="btn-hud primary"
                  style={{ padding: "4px 10px" }}
                  disabled={(!copilotPrompt.trim() && attachedImages.length === 0) || isWorking}
                >
                  <Send size={12} />
                  <span>Execute</span>
                </button>
              </div>
            </div>
          </form>
        </aside>
      </div>

      {/* Context Selection Modal */}
      {showAddContextModal && (
        <div className="context-modal-overlay" onClick={() => setShowAddContextModal(false)}>
          <div className="context-modal" onClick={(e) => e.stopPropagation()}>
            <div className="context-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Paperclip size={15} color="#10b981" />
                <span style={{ fontWeight: 700, fontSize: "13px", color: "#fff" }}>AI Bağlamına (Context) Dosya Ekle</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddContextModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="context-modal-search">
              <Search size={14} color="var(--text-dim)" />
              <input
                type="text"
                autoFocus
                placeholder="Dosya ara (örn: Navbar, AuthContext, App.tsx)..."
                value={contextSearchQuery}
                onChange={(e) => setContextSearchQuery(e.target.value)}
              />
            </div>
            <div className="context-modal-list">
              {modalFilteredFiles.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-dim)", fontSize: "12px" }}>
                  Eşleşen dosya bulunamadı.
                </div>
              ) : (
                modalFilteredFiles.map((filePath) => {
                  const isSelected = contextFiles.includes(filePath);
                  const fileName = filePath.split("/").pop() || filePath;
                  return (
                    <div
                      key={filePath}
                      className={`context-modal-item ${isSelected ? "selected" : ""}`}
                      onClick={() => toggleContextFile(filePath)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                        <FileCode size={14} color={isSelected ? "#10b981" : "#38bdf8"} />
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: isSelected ? 700 : 500, color: isSelected ? "#fff" : "var(--text-muted)" }}>
                            {fileName}
                          </div>
                          <div style={{ fontSize: "10px", color: "var(--text-dim)", fontFamily: "var(--font-mono, monospace)" }}>
                            {filePath}
                          </div>
                        </div>
                      </div>
                      <div>
                        {isSelected ? (
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
                            <Check size={12} /> Eklendi
                          </span>
                        ) : (
                          <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>+ Ekle</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="context-modal-footer">
              <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                {contextFiles.length} dosya bağlamda seçili
              </span>
              <button
                type="button"
                onClick={() => setShowAddContextModal(false)}
                className="btn-hud"
                style={{
                  background: "#10b981",
                  color: "#000",
                  border: "none",
                  fontWeight: 700,
                  padding: "5px 14px",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
