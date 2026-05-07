import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DataSourceProvider } from "./context/DataSourceContext";
import { EtfDashboardPage } from "./pages/EtfDashboard";
import { HomePage } from "./pages/Home";
import { RegistryPage } from "./pages/Registry";

export default function App() {
  return (
    <BrowserRouter>
      <DataSourceProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="registry" element={<RegistryPage />} />
            <Route path="etf/:code" element={<EtfDashboardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </DataSourceProvider>
    </BrowserRouter>
  );
}
