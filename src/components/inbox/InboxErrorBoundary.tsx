import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tr } from "@/i18n";

// Local error boundary for the inbox thread/list. Unlike the app-wide
// ErrorBoundary in components/ErrorBoundary.tsx (which handles chunk-load
// failures with a full reload), this one catches render errors in just the
// thread or list subtree and offers an in-place "Tentar novamente" that
// resets the boundary's internal state without losing the rest of the inbox
// (drafts, selection, presence, etc.).
//
// The `resetKey` prop lets the parent force a reset (e.g. when switching
// conversations) so a previous error doesn't stick across a context change.
type Props = {
  children: ReactNode;
  resetKey?: string | number;
  label?: string;
};

type State = { hasError: boolean; error: unknown };

export class InboxErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prev: Props) {
    // Reset when the parent signals a context change (new conversation, etc.)
    // or when the boundary is re-mounted via key.
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error: unknown) {
    console.error("[InboxErrorBoundary]", this.props.label ?? "inbox", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {tr("Algo correu mal ao mostrar esta conversa")}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {tr("Podes tentar novamente ou abrir outra conversa.")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            {tr("Tentar novamente")}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
