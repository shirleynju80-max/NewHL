import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DataSourceProvider } from "./context/DataSourceContext";
import { StrategyRegistryProvider } from "./context/StrategyRegistryContext";

const HomePage = lazy(() => import("./pages/Home").then((m) => ({ default: m.HomePage })));
const MonitorPage = lazy(() => import("./pages/Monitor").then((m) => ({ default: m.MonitorPage })));
const IndicesListPage = lazy(() =>
 import("./pages/IndicesListPage").then((m) => ({ default: m.IndicesListPage }))
);
const IndexDetailPage = lazy(() =>
 import("./pages/IndexDetailPage").then((m) => ({ default: m.IndexDetailPage }))
);
const ProductsPage = lazy(() => import("./pages/ProductsPage").then((m) => ({ default: m.ProductsPage })));
const ComparePage = lazy(() => import("./pages/ComparePage").then((m) => ({ default: m.ComparePage })));
const RegistryPage = lazy(() => import("./pages/Registry").then((m) => ({ default: m.RegistryPage })));
const EtfDashboardPage = lazy(() =>
 import("./pages/EtfDashboard").then((m) => ({ default: m.EtfDashboardPage }))
);

function PageFallback() {
 return (
 <div className="rounded-lg border border-fin-border bg-white px-5 py-4 text-sm fin-muted-text shadow-sm">
 页面加载中…
 </div>
 );
}

function withPageFallback(children: ReactNode) {
 return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

export default function App() {
 return (
 <BrowserRouter>
 <DataSourceProvider>
 <StrategyRegistryProvider>
 <Routes>
 <Route element={<Layout />}>
 <Route index element={withPageFallback(<HomePage />)} />
 <Route path="monitor" element={withPageFallback(<MonitorPage />)} />
 <Route path="indices/:indexCode" element={withPageFallback(<IndexDetailPage />)} />
 <Route path="indices" element={withPageFallback(<IndicesListPage />)} />
 <Route path="products" element={withPageFallback(<ProductsPage />)} />
 <Route path="compare" element={withPageFallback(<ComparePage />)} />
 <Route path="registry" element={withPageFallback(<RegistryPage />)} />
 <Route path="etf/:code" element={withPageFallback(<EtfDashboardPage />)} />
 <Route path="*" element={<Navigate to="/" replace />} />
 </Route>
 </Routes>
 </StrategyRegistryProvider>
 </DataSourceProvider>
 </BrowserRouter>
 );
}
