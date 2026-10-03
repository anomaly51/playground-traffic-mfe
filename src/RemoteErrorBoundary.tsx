import { Warning } from "@phosphor-icons/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RemoteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Traffic MFE render failure", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="traffic-crash" role="alert">
        <Warning size={24} weight="duotone" aria-hidden="true" />
        <div>
          <strong>Traffic MFE could not render</strong>
          <p>{this.state.error.message}</p>
        </div>
        <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => window.location.reload()}>
          Reload application
        </button>
      </section>
    );
  }
}
