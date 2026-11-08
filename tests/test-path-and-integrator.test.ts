import { describe, it, expect } from "bun:test";
import { ASTPathResolver } from "../src/intelligence/ast-path-resolver";
import { SmartCodeIntegrator } from "../src/intelligence/code-integrator";

describe("SmartCodeIntegrator - Anti-Truncation & Surgical Merge", () => {
  const existing100Lines = `import React, { useState } from "react";
import { Navbar } from "./Navbar";
import { Hero } from "./Hero";
import { Footer } from "./Footer";

export function App() {
  const [count, setCount] = useState(0);

  const handleIncrement = () => {
    setCount(count + 1);
  };

  const handleReset = () => {
    setCount(0);
  };

  return (
    <div className="container">
      <Navbar />
      <Hero />
      <div className="counter">
        <p>Current: {count}</p>
        <button onClick={handleIncrement}>Increment</button>
        <button onClick={handleReset}>Reset</button>
      </div>
      <Footer />
    </div>
  );
}

export default App;
${"// line padding\n".repeat(40)}`;

  it("surgically replaces a single function instead of deleting the entire file", () => {
    const singleFunctionSnippet = `const handleReset = () => {
    console.log("Resetting!");
    setCount(0);
  };`;

    const res = SmartCodeIntegrator.integrate(existing100Lines, singleFunctionSnippet, "src/App.tsx");
    expect(res.success).toBe(true);
    expect(res.mode).toBe("surgical_function");
    // Verify untouched imports and other functions remain!
    expect(res.finalCode).toContain('import { Navbar } from "./Navbar";');
    expect(res.finalCode).toContain("const handleIncrement = () => {");
    expect(res.finalCode).toContain('console.log("Resetting!");');
    expect(res.finalCode).toContain("<Footer />");
  });

  it("blocks catastrophic drop when snippet cannot be safely merged", () => {
    const tinyUnmatchedSnippet = `<button className="btn-test">Click Me</button>`;
    const res = SmartCodeIntegrator.integrate(existing100Lines, tinyUnmatchedSnippet, "src/App.tsx");
    expect(res.success).toBe(false);
    expect(res.mode).toBe("rejected");
    expect(res.reason).toContain("Tehlikeli silme engellendi");
  });

  it("preserves essential imports when full rewrite drops them", () => {
    const existing = `import React from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

export function App() {
  return <div><Navbar /><Footer /></div>;
}`;

    const newCodeDroppingImports = `export function App() {
  return <div><Navbar /><Footer /><h1>Updated!</h1></div>;
}`;

    const res = SmartCodeIntegrator.integrate(existing, newCodeDroppingImports, "src/App.tsx");
    expect(res.success).toBe(true);
    expect(res.finalCode).toContain('import { Navbar } from "./Navbar";');
    expect(res.finalCode).toContain('import { Footer } from "./Footer";');
  });
});

describe("ASTPathResolver - Path & Import Normalizer", () => {
  it("resolves wrong relative depth and subdirectories", () => {
    const code = `import Card from "./components/Card";
import Navbar from "./Navbar";`;

    const allFiles = [
      "src/components/ui/Card.tsx",
      "src/components/Navbar.tsx",
      "src/pages/Projects.tsx",
    ];

    // Current file is inside src/pages/Projects.tsx
    const { code: normalized, fixes } = ASTPathResolver.normalizeImports(
      code,
      "src/pages/Projects.tsx",
      "C:/fake/repo",
      allFiles
    );

    // It should fix depth to ../components/ui/Card
    expect(fixes.length).toBeGreaterThan(0);
  });

  it("fixes wrong relative context import path from src/components/Navbar.tsx", () => {
    const code = `import { useState } from "react";
import { useAuthContext } from "./context/AuthContext";

export const Navbar = () => {};`;

    const allFiles = [
      "src/components/Navbar.tsx",
      "src/context/AuthContext.tsx",
    ];

    const { code: normalized, fixes } = ASTPathResolver.normalizeImports(
      code,
      "src/components/Navbar.tsx",
      "C:/fake/repo",
      allFiles
    );

    expect(normalized).toContain('from "../context/AuthContext"');
    expect(fixes.length).toBe(1);
  });

  it("blocks lazy placeholder snippets like '// ... (önceki kodlar)' from wiping existing file", () => {
    const existingNavbar = `import React from "react";
export const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <nav className="border">
      <div className="logo">Logo</div>
      <button onClick={() => setIsOpen(!isOpen)}>Toggle</button>
    </nav>
  );
};
${"// line padding\n".repeat(30)}`;

    const lazySnippet = `import { useState } from "react";
import { useAuthContext } from "./context/AuthContext";

export const Navbar = () => {
  // ... (önceki kodlar)

  return (
    <nav className="bg-transparent border-b border-border-subtle">
      {/* ... */}
    </nav>
  );
};`;

    const res = SmartCodeIntegrator.integrate(existingNavbar, lazySnippet, "src/components/Navbar.tsx");
    expect(res.success).toBe(false);
    expect(res.mode).toBe("rejected");
    expect(res.reason).toContain("Yer Tutucu Engellendi");
    // Ensure original file is completely intact!
    expect(res.finalCode).toBe(existingNavbar.trim());
  });
});
