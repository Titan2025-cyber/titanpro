import { TrendingUp, PieChart, DollarSign, AlertTriangle, Gauge } from "lucide-react";
import HubShell from "@/components/HubShell";
import Profitability from "@/pages/Profitability";
import ProfitabilityByType from "@/pages/ProfitabilityByType";
import JobCostLive from "@/pages/JobCostLive";
import MidJobMarginAlert from "@/pages/MidJobMarginAlert";
import EstimatorPerformance from "@/pages/EstimatorPerformance";

export default function ProfitabilityHub() {
  return (
    <HubShell
      title="Profitability"
      description="Overall profitability, profit by job type, live job costs, margin alerts, and estimator performance in one view."
      icon={TrendingUp}
      tabs={[
        { value: "overview", label: "Profitability", icon: TrendingUp, component: Profitability },
        { value: "by-type", label: "By Job Type", icon: PieChart, component: ProfitabilityByType },
        { value: "live-costs", label: "Live Job Costs", icon: DollarSign, component: JobCostLive },
        { value: "margin-alert", label: "Margin Alerts", icon: AlertTriangle, component: MidJobMarginAlert },
        { value: "estimators", label: "Estimator Performance", icon: Gauge, component: EstimatorPerformance },
      ]}
    />
  );
}
