import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { resetMonitorStrategyPrefStorage } from "../lib/etfMonitorStrategyPref";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RouteErrorBoundary]", error, info.componentStack);
  }

  private handleResetPrefs = () => {
    resetMonitorStrategyPrefStorage();
    try {
      localStorage.removeItem("desk.userRegisteredStrategies.v1");
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error.message || String(this.state.error);

    return (
      <div className="ft-page max-w-lg space-y-4 p-8">
        <h2 className="fin-page-title text-lg">页面加载出错</h2>
        <p className="text-sm fin-muted-text">
          Safari
          硬刷新后若出现白屏，多为脚本异常或本地缓存数据损坏。可尝试下方操作。
        </p>
        <pre className="overflow-x-auto rounded-lg border border-fin-border bg-transparent p-3 text-[11px] text-[var(--fin-red)]">
          {msg}
        </pre>
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            className="fin-chip-filter"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
          <button
            type="button"
            className="fin-chip-filter"
            onClick={this.handleResetPrefs}
          >
            清除策略本地数据并重载
          </button>
          <Link to="/" className="fin-link self-center">
            返回首页
          </Link>
        </div>
      </div>
    );
  }
}
