import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * A query that throws — a revoked session, a Page whose membership went stale —
 * used to unmount the whole tree and leave a blank window with nothing but a
 * console message. This keeps the failure on screen and recoverable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-4 p-8">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{describe(error)}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </main>
    );
  }
}

function describe(error: Error): string {
  // Convex wraps the thrown value; `data` holds what the function actually threw.
  const data = (error as { data?: unknown }).data;
  if (typeof data === "string") return data;
  return error.message;
}
