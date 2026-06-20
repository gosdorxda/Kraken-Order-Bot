import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Settings, Zap, LogOut, ScrollText } from "lucide-react";
import { clearToken } from "@/lib/auth";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const handleLogout = () => {
    clearToken();
    navigate("/login");
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary/30 flex flex-col">
      {/* Top navbar */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-bold text-base tracking-tight text-white">KRKN.BOT</span>
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

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
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
