import { Camera, Search, Sparkles } from "lucide-react";
import HubShell from "@/components/HubShell";
import Photos from "@/pages/Photos";
import PhotoSearch from "@/pages/PhotoSearch";
import PhotoClassifier from "@/pages/PhotoClassifier";

export default function PhotosHub() {
  return (
    <HubShell
      title="Photos"
      description="Every photo across every job — capture, search, and AI-classify. The camera tab uploads and organizes by category; search finds any photo across jobs; AI Classify auto-tags photos by content."
      icon={Camera}
      tabs={[
        { value: "capture", label: "Capture", icon: Camera, component: Photos },
        { value: "search", label: "Search", icon: Search, component: PhotoSearch },
        { value: "classify", label: "AI Classify", icon: Sparkles, component: PhotoClassifier },
      ]}
    />
  );
}
