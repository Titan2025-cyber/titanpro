import { useId } from "react";
import { useReducedMotion } from "framer-motion";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  testid?: string;
}

// Tiny axis-less trend line for KPI cards. Draws in on mount (disabled when
// prefers-reduced-motion). Renders a flat baseline when there is no real series.
export default function Sparkline({
  data,
  color = "hsl(var(--titan-blue))",
  height = 40,
  testid,
}: SparklineProps) {
  const reduced = useReducedMotion();
  const gradId = useId().replace(/:/g, "");

  // Need >= 2 points for an area; pad/duplicate gracefully.
  const series =
    data.length >= 2 ? data : data.length === 1 ? [0, data[0]] : [0, 0];
  const chartData = series.map((v, i) => ({ i, v }));

  return (
    <div style={{ height }} data-testid={testid}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 3, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${gradId})`}
            dot={false}
            isAnimationActive={!reduced}
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
