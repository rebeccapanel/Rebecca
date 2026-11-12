import { useId } from "react"

import { cn } from "@/lib/utils"

type Series = {
  values: number[]
  tone?: string
  label?: string
}

type SparklineProps = {
  series: Series[]
  height?: number
  className?: string
  /** Fixed upper bound; defaults to the data maximum. */
  max?: number
  showArea?: boolean
  showGrid?: boolean
  /** Dots the final point of the first series. */
  markLast?: boolean
}

/**
 * Dependency-free sparkline. Every series shares one clock and one scale, so
 * overlapping lines stay comparable; a fixed viewBox keeps it stable while the
 * container resizes.
 */
export function Sparkline({
  series,
  height = 44,
  className,
  max,
  showArea = true,
  showGrid = false,
  markLast = false,
}: SparklineProps) {
  const gradientId = useId().replace(/[:]/g, "")
  const width = 240
  const allValues = series.flatMap((item) => item.values).filter((value) => Number.isFinite(value))
  const upper = max ?? Math.max(...allValues, 1)
  const span = Math.max(upper, 1)

  const point = (value: number, index: number, length: number) => {
    const x = length <= 1 ? 0 : (index / (length - 1)) * width
    const y = height - (Math.max(0, Math.min(value, span)) / span) * height
    return [x, y] as const
  }

  const toPath = (values: number[]) =>
    values
      .map((value, index) => {
        const [x, y] = point(value, index, values.length)
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(" ")

  const firstSeries = series[0]
  const lastPoint =
    firstSeries && firstSeries.values.length > 0
      ? point(
          firstSeries.values[firstSeries.values.length - 1],
          firstSeries.values.length - 1,
          firstSeries.values.length,
        )
      : null

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full overflow-visible", className)}
      style={{ height }}
      role="img"
    >
      <defs>
        {series.map((item, index) => (
          <linearGradient key={index} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={item.tone ?? "var(--primary)"} stopOpacity="0.3" />
            <stop offset="100%" stopColor={item.tone ?? "var(--primary)"} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {showGrid
        ? [0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2={width}
              y1={height * fraction}
              y2={height * fraction}
              stroke="currentColor"
              strokeOpacity="0.08"
              strokeDasharray="2 4"
              vectorEffect="non-scaling-stroke"
            />
          ))
        : null}

      {series.map((item, index) => {
        if (item.values.length === 0) return null
        const path = toPath(item.values)
        return (
          <g key={index}>
            {showArea && item.values.length > 1 ? (
              <path
                d={`${path} L${width} ${height} L0 ${height} Z`}
                fill={`url(#${gradientId}-${index})`}
                stroke="none"
              />
            ) : null}
            <path
              d={path}
              fill="none"
              stroke={item.tone ?? "var(--primary)"}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}

      {markLast && lastPoint ? (
        <circle
          cx={lastPoint[0]}
          cy={lastPoint[1]}
          r="2.6"
          fill={firstSeries?.tone ?? "var(--primary)"}
          stroke="var(--card)"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )
}
