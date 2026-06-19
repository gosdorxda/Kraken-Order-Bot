import { useState } from "react";
import { useLocation } from "wouter";
import { Zap, Loader2, Lock } from "lucide-react";
import { useAuthLogin } from "@workspace/api-client-react";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Login() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useAuthLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate(
      { data: { password } },
      {
        onSuccess: (data) => {
          setToken(data.token);
          navigate("/");
        },
        onError: () => {
          setError("Password salah. Coba lagi.");
          setPassword("");
        },
      }
    );
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2.5">
            <Zap className="h-7 w-7 text-primary" />
            <span className="font-bold text-2xl tracking-tight text-white">KRKN.BOT</span>
          </div>
          <p className="text-muted-foreground text-sm">Masukkan password untuk mengakses dashboard</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 font-mono h-11"
                autoFocus
                autoComplete="current-password"
                disabled={login.isPending}
              />
            </div>
            {error && (
              <p className="text-sm text-red-400 flex items-center gap-1.5">
                <span>⚠</span> {error}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full h-11 font-semibold"
            disabled={login.isPending || !password}
          >
            {login.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Memverifikasi…</>
            ) : (
              "Masuk"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
