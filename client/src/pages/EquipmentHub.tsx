import { Wrench, TrendingUp, BellRing, RefreshCcw, Package } from "lucide-react";
import HubShell from "@/components/HubShell";
import Equipment from "@/pages/Equipment";
import EquipmentROI from "@/pages/EquipmentROI";
import EquipmentAlerts from "@/pages/EquipmentAlerts";
import EquipmentLifecycle from "@/pages/EquipmentLifecycle";
import Consumables from "@/pages/Consumables";

export default function EquipmentHub() {
  return (
    <HubShell
      title="Equipment"
      description="Equipment, consumables inventory, ROI, alerts, and lifecycle tracking in one workspace."
      icon={Wrench}
      tabs={[
        { value: "inventory", label: "Equipment", icon: Wrench, component: Equipment },
        { value: "consumables", label: "Consumables", icon: Package, component: Consumables },
        { value: "roi", label: "ROI", icon: TrendingUp, component: EquipmentROI },
        { value: "alerts", label: "Alerts", icon: BellRing, component: EquipmentAlerts },
        { value: "lifecycle", label: "Lifecycle", icon: RefreshCcw, component: EquipmentLifecycle },
      ]}
    />
  );
}
