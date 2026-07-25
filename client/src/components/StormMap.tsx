import { motion, useReducedMotion } from "framer-motion";

// Approximate command-center positions (viewBox 0 0 400 300) for the service
// ZIPs. Not geographically exact — a clean abstract layout of the SC/GA region.
const ZIP_XY: Record<string, { x: number; y: number; label: string }> = {
  "29036": { x: 300, y: 70, label: "Chapin" },
  "29201": { x: 330, y: 120, label: "Columbia" },
  "29803": { x: 230, y: 165, label: "Aiken" },
  "29841": { x: 165, y: 150, label: "N. Augusta" },
  "30904": { x: 120, y: 175, label: "Augusta" },
  "30907": { x: 90, y: 140, label: "Martinez" },
  "30809": { x: 105, y: 105, label: "Evans" },
};

// Stylized, abstract SC/GA service-region outline (not to scale).
const REGION_PATH =
  "M60 120 L120 70 L210 60 L300 55 L360 95 L365 160 L300 205 L210 220 L130 210 L70 175 Z";

interface StormMapProps {
  zips: string[];
  activeZips: string[];
}

export default function StormMap({ zips, activeZips }: StormMapProps) {
  const reduced = useReducedMotion();
  const activeSet = new Set(activeZips);

  return (
    <div
      className="titan-card-lit relative overflow-hidden rounded-xl"
      data-testid="storm-map"
      style={{ background: "hsl(var(--card))" }}
    >
      {/* ambient glow layer */}
      <div className="titan-glow" style={{ inset: 0 }} aria-hidden="true" />

      <div className="relative z-[1] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="tp-page-eyebrow">Regional Radar</span>
          <div className="flex items-center gap-3 text-[0.68rem] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "hsl(var(--titan-red))" }} />
              Active
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "hsl(var(--titan-blue))" }} />
              Monitoring
            </span>
          </div>
        </div>

        <svg viewBox="0 0 400 300" className="w-full h-auto" role="img" aria-label="Storm service-region radar map">
          <defs>
            <radialGradient id="stormRadarBg" cx="45%" cy="55%" r="75%">
              <stop offset="0%" stopColor="hsl(var(--titan-blue))" stopOpacity={0.16} />
              <stop offset="100%" stopColor="hsl(var(--titan-blue))" stopOpacity={0} />
            </radialGradient>
            <linearGradient id="stormRegionFill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(var(--titan-blue))" stopOpacity={0.18} />
              <stop offset="100%" stopColor="hsl(var(--titan-red))" stopOpacity={0.10} />
            </linearGradient>
            <linearGradient id="stormSweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(var(--titan-blue))" stopOpacity={0} />
              <stop offset="100%" stopColor="hsl(var(--titan-blue))" stopOpacity={0.35} />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="400" height="300" fill="url(#stormRadarBg)" />

          {/* radar grid: concentric rings + crosshair */}
          <g stroke="hsl(var(--titan-blue))" strokeOpacity={0.18} fill="none">
            {[40, 90, 140, 190].map((r) => (
              <circle key={r} cx="200" cy="150" r={r} />
            ))}
            <line x1="200" y1="10" x2="200" y2="290" />
            <line x1="20" y1="150" x2="380" y2="150" />
          </g>

          {/* rotating radar sweep */}
          {!reduced && (
            <motion.g
              style={{ transformOrigin: "200px 150px" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 6, ease: "linear", repeat: Infinity }}
            >
              <path d="M200 150 L200 10 A140 140 0 0 1 320 80 Z" fill="url(#stormSweep)" />
            </motion.g>
          )}

          {/* stylized region outline */}
          <path
            d={REGION_PATH}
            fill="url(#stormRegionFill)"
            stroke="hsl(var(--titan-blue))"
            strokeOpacity={0.5}
            strokeWidth={1.5}
          />

          {/* ZIP pins */}
          {zips.map((zip) => {
            const pos = ZIP_XY[zip];
            if (!pos) return null;
            const isActive = activeSet.has(zip);
            const color = isActive ? "hsl(var(--titan-red))" : "hsl(var(--titan-blue))";
            return (
              <g key={zip} data-testid={`storm-pin-${zip}`}>
                {isActive && !reduced && (
                  <motion.circle
                    cx={pos.x}
                    cy={pos.y}
                    r={6}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                    initial={{ r: 6, opacity: 0.8 }}
                    animate={{ r: 20, opacity: 0 }}
                    transition={{ duration: 1.8, ease: "easeOut", repeat: Infinity }}
                  />
                )}
                {isActive && reduced && (
                  <circle cx={pos.x} cy={pos.y} r={12} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.5} />
                )}
                <circle cx={pos.x} cy={pos.y} r={5} fill={color} />
                <circle cx={pos.x} cy={pos.y} r={5} fill="none" stroke="white" strokeOpacity={0.6} strokeWidth={0.75} />
                <text
                  x={pos.x}
                  y={pos.y - 10}
                  textAnchor="middle"
                  fontSize="9"
                  fill="hsl(var(--muted-foreground))"
                >
                  {pos.label}
                </text>
              </g>
            );
          })}
        </svg>

        <p className="text-[0.68rem] text-muted-foreground mt-1 text-center">
          {activeZips.length > 0
            ? `${activeZips.length} ZIP${activeZips.length !== 1 ? "s" : ""} with active response · ${zips.length} monitored`
            : `${zips.length} service ZIPs monitored · all quiet`}
        </p>
      </div>
    </div>
  );
}
