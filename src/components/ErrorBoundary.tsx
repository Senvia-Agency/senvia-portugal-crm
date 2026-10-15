import { Component, type ReactNode } from "react";
import { toast } from "sonner";

// Lazy chunks can disappear after a deployment while an older tab stays open.
// Ordinary API/network errors must not be treated as a missing app chunk.
const CHUNK_ERROR_RE =
  /Loading chunk|dynamically imported module|module script failed|ChunkLoadError|Failed to fetch dynamically imported module/i;

export function isChunkError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CHUNK_ERROR_RE.test(msg);
}

export function handlePreloadError(event: Event): void {
  // Suppress Vite's default throw; a preload failure must never force a reload.
  event.preventDefault();
  toast.warning("Não foi possível carregar esta página", {
    id: "app-chunk-update",
    description: "Guarda o que estás a escrever antes de atualizar o sistema.",
    duration: Infinity,
    action: { label: "Atualizar agora", onClick: () => window.location.reload() },
  });
}

type Phase = "ok" | "update" | "error";

export class ErrorBoundary extends Component<{ children: ReactNode }, { phase: Phase }> {
  state: { phase: Phase } = { phase: "ok" };

  static getDerivedStateFromError(error: unknown): { phase: Phase } {
    return { phase: isChunkError(error) ? "update" : "error" };
  }

  componentDidCatch(error: unknown) {
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (this.state.phase !== "ok") {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-background text-center p-6">
          <h1 className="text-xl font-semibold">
            {this.state.phase === "update" ? "É necessário atualizar o sistema" : "Ocorreu um erro"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm">
            Não foi possível carregar esta página. O sistema não será recarregado automaticamente.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
