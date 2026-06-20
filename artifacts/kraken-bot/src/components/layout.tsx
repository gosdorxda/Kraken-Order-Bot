import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Settings, Zap, LogOut, ScrollText, BarChart2, Moon, Sun, Type } from "lucide-react";
import { clearToken } from "@/lib/auth";
import { useTheme, useFont } from "@/lib/preferences";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { font, setFont, options: fontOptions } = useFont();
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const fontMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (fontMenuRef.current && !fontMenuRef.current.contains(e.target as Node)) {
        setFontMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    clearToken();
    navigate("/login");
  };

  const isDark = theme === "dark";

  return (
    <div className="min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary/30 flex flex-col">
      {/* Top navbar */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-bold text-base tracking-tight text-foreground">KRKN.BOT</span>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-1 flex-1">
            <Link
              href="/"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                location === "/"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <Activity className="h-4 w-4" />
              Dashboard
            </Link>
            <Link
              href="/market"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                location === "/market"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <BarChart2 className="h-4 w-4" />
              Market
            </Link>
            <Link
              href="/logs"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                location === "/logs"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <ScrollText className="h-4 w-4" />
              Log
            </Link>
            <Link
              href="/settings"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                location === "/settings"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            {/* Font selector */}
            <div className="relative" ref={fontMenuRef}>
              <button
                onClick={() => setFontMenuOpen((o) => !o)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  fontMenuOpen
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                title="Ganti font"
              >
                <Type className="h-4 w-4" />
                <span className="hidden sm:inline text-xs">Font</span>
              </button>

              {fontMenuOpen && (
                <div className="absolute right-0 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-50 py-1 text-sm">
                  {fontOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setFont(opt.value); setFontMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        font === opt.value
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-secondary"
                      }`}
                      style={{ fontFamily: opt.value }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              title={isDark ? "Mode terang" : "Mode gelap"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden sm:inline text-xs">{isDark ? "Terang" : "Gelap"}</span>
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline text-xs">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
