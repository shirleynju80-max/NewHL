import { Link } from "react-router-dom";
import { EtfCompareWorkbench } from "../components/EtfCompareWorkbench";
import { PageHeader } from "../components/PageHeader";

export function ComparePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        kicker="策略层"
        title="ETF对比工具"
        breadcrumbs={[
          { label: "配置总览", to: "/" },
          { label: "ETF对比工具" },
        ]}
        description={
          <>
            策略层工具：在统一时间窗下横向比较多只 ETF 的收益、回撤与相关性，用于分散度检查与规则研究。
            <strong className="font-medium text-[var(--fin-text)]"> 勿按短期收益排名选底仓</strong>；长期配置请先看
            <Link to="/indices" className="mx-1 fin-link">
              指数研究
            </Link>
            与
            <Link to="/products" className="fin-link">
              产品选择
            </Link>
            。
          </>
        }
      />
      <EtfCompareWorkbench />
    </div>
  );
}
