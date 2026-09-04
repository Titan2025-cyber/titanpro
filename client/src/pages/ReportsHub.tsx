import { BarChart3, PieChart, Brain, TrendingUp, Star, Target } from "lucide-react";
import HubShell from "@/components/HubShell";
import Reports from "@/pages/Reports";
import Analytics from "@/pages/Analytics";
import CommandBI from "@/pages/CommandBI";
import PredictiveModel from "@/pages/PredictiveModel";
import NPSSurveys from "@/pages/NPSSurveys";
import LeadAttribution from "@/pages/LeadAttribution";

export default function ReportsHub() {
  return (
    <HubShell
      title="Reports & BI"
      description="Business intelligence in one place — standard reports, analytics, executive dashboards, predictive models, customer NPS, and lead attribution."
      icon={BarChart3}
      tabs={[
        { value: "overview", label: "Reports", icon: BarChart3, component: Reports },
        { value: "analytics", label: "Analytics", icon: PieChart, component: Analytics },
        { value: "command-bi", label: "Command BI", icon: Brain, component: CommandBI },
        { value: "predictive", label: "Predictive", icon: TrendingUp, component: PredictiveModel },
        { value: "nps", label: "NPS", icon: Star, component: NPSSurveys },
        { value: "attribution", label: "Attribution", icon: Target, component: LeadAttribution },
      ]}
    />
  );
}
