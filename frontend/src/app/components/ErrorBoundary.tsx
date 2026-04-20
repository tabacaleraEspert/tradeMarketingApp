import { Component, ReactNode, ErrorInfo } from "react";
import { captureException } from "@/lib/observability";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorCode: string | null;
}

/**
 * Error boundary global. Captura excepciones de render que escapan a try/catch
 * (typeof undefined .map, etc) y muestra una pantalla amigable con un código
 * para reporte. Sin esto, el user ve una pantalla en blanco y no entiende qué pasó.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorCode: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Generar un código corto para que el user pueda decírselo al admin
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    return { hasError: true, error, errorCode: code };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary]", this.state.errorCode, error, errorInfo);
    // Reportar a Sentry (si está activo). Si no, sólo queda en console.
    captureException(error, {
      errorCode: this.state.errorCode,
      componentStack: errorInfo.componentStack,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleHome = () => {
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-card rounded-2xl border border-border shadow-lg p-8 text-center">
          <div className="text-6xl mb-4">😕</div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Algo salió mal</h1>
          <p className="text-sm text-muted-foreground mb-6">
            La aplicación encontró un error inesperado. Tratá de recargar la pantalla.
            Si vuelve a pasar, avisale al administrador con este código:
          </p>
          <div className="bg-muted/60 rounded-lg p-3 mb-6 font-mono text-sm font-semibold text-foreground tracking-wider">
            {this.state.errorCode}
          </div>
          {this.state.error?.message && (
            <details className="mb-6 text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Detalles técnicos
              </summary>
              <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded mt-2 overflow-auto max-h-32">
                {this.state.error.message}
                {"\n\n"}
                {this.state.error.stack?.split("\n").slice(0, 5).join("\n")}
              </pre>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.handleReload}
              className="flex-1 px-4 py-2.5 bg-[#A48242] text-white rounded-lg font-semibold hover:bg-[#8B6E38] transition-colors"
            >
              Recargar
            </button>
            <button
              onClick={this.handleHome}
              className="flex-1 px-4 py-2.5 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors"
            >
              Ir al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}
