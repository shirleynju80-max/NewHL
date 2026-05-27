import { useMemo } from "react";
import { useDataSource } from "../context/DataSourceContext";
import { ConfigDeskOverview } from "../components/ConfigDeskOverview";
import { buildHomeDimensionSnapshots } from "../lib/configFramework";

export function HomePage() {
  const { indices, bondByDate, indexTracking } = useDataSource();

  const dimensionSnapshots = useMemo(
    () => buildHomeDimensionSnapshots({ indices, bondByDate, indexTracking }),
    [indices, bondByDate, indexTracking],
  );
  return (
    <div className="ft-page space-y-8">
      <ConfigDeskOverview
        shareholderCard={dimensionSnapshots.shareholder_return}
      />
    </div>
  );
}
