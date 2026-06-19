import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Settings, Zap } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground font-sans selection:bg-primary/30">
      {/* Sidebar */}
      <div className="w-16 md:w-64 border-r border-border bg-card flex flex-col justify-between shrink-0">
        <div>
          <div className="h-16 flex items-center justify-center md:justify-start px-4 border-b border-border">
            <Zap className="h-6 w-6 text-primary" />
            <span className="ml-3 font-bold text-lg hidden md:block tracking-tight text-white">KRKN.BOT</span>
          </div>
          <nav className="p-2 space-y-1 mt-4">
            <Link href="/" className={`flex items-center px-3 py-3 rounded-md transition-colors ${location === "/" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
              <Activity className="h-5 w-5 shrink-0" />
              <span className="ml-3 font-medium hidden md:block">Dashboard</span>
            </Link>
            <Link href="/settings" className={`flex items-center px-3 py-3 rounded-md transition-colors ${location === "/settings" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
              <Settings className="h-5 w-5 shrink-0" />
              <span className="ml-3 font-medium hidden md:block">Settings</span>
            </Link>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
