import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { resetMonitorStrategyPrefStorage } from "../lib/etfMonitorStrategyPref";

type Props = { children: ReactNode; etfCode?: string };
type State = { error: Error | null };

/** ETF 详情页专用：避免整站白屏，并给出 515100 等页的恢复指引 */
export class EtfPageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[EtfPageErrorBoundary]", this.props.etfCode, error, info);
  }

  private handleResetLocal = () => {
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

    const code = this.props.etfCode;
    const msg = this.state.error.message || String(this.state.error);

    return (
      <div className="fin-panel mx-auto max-w-lg space-y-4 p-8">
        <h2 className="text-lg font-semibold text-[var(--fin-text)]">
          {code ? `${code} 详情页加载失败` : "ETF 详情页加载失败"}
        </h2>
        <p className="text-sm fin-muted-text">
          Safari
          硬刷新后若仅本页白屏，多为本地策略缓存损坏或图表初始化异常。可先清除本站数据后重载。
        </p>
        <pre className="overflow-x-auto rounded-lg border border-fin-border bg-fin-panel-muted p-3 text-[11px] text-[var(--fin-red)]">
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
            onClick={this.handleResetLocal}
          >
            清除策略本地数据
          </button>
          <Link to="/products" className="fin-link self-center">
            返回产品选择
          </Link>
        </div>
      </div>
    );
  }
}
