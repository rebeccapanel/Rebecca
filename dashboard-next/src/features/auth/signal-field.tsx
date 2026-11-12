import { useTranslation } from "react-i18next"

/**
 * Decorative network field for the sign-in screen. Pure SVG + CSS: no canvas,
 * no animation library, and it stops entirely under `prefers-reduced-motion`.
 */
const NODES = [
  { x: 470, y: 250, r: 5.5, hero: true },
  { x: 300, y: 170, r: 4 },
  { x: 640, y: 190, r: 3.5 },
  { x: 690, y: 380, r: 5 },
  { x: 520, y: 420, r: 3.5 },
  { x: 350, y: 330, r: 4.5 },
  { x: 230, y: 470, r: 3.5 },
  { x: 420, y: 590, r: 5 },
  { x: 620, y: 560, r: 3.5 },
  { x: 760, y: 590, r: 3 },
  { x: 300, y: 690, r: 3 },
  { x: 540, y: 730, r: 4 },
  { x: 150, y: 300, r: 3 },
  { x: 800, y: 260, r: 2.5 },
]

const EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  [1, 5], [1, 12], [5, 6], [5, 7], [3, 4], [3, 8], [3, 13],
  [4, 7], [4, 8], [6, 7], [7, 10], [7, 11], [8, 9], [8, 11], [2, 3], [9, 10],
]

export function SignalField() {
  const { t } = useTranslation()
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_72%_18%,oklch(0.46_0.1_188/0.34),transparent_58%),radial-gradient(80%_70%_at_18%_82%,oklch(0.36_0.09_262/0.34),transparent_55%)]" />
      <div
        className="absolute inset-0 opacity-[0.13]"
        style={{
          backgroundImage:
            "linear-gradient(to right, oklch(1 0 0 / 0.55) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 0.55) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
          maskImage: "radial-gradient(72% 64% at 52% 46%, black 10%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(72% 64% at 52% 46%, black 10%, transparent 78%)",
        }}
      />
      <svg
        viewBox="0 0 900 900"
        className="absolute inset-0 size-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="field-fade" cx="50%" cy="48%" r="58%">
            <stop offset="55%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="field-mask">
            <rect width="900" height="900" fill="url(#field-fade)" />
          </mask>
        </defs>

        <g mask="url(#field-mask)">
          {EDGES.map(([from, to], index) => {
            const a = NODES[from]
            const b = NODES[to]
            return (
              <line
                key={`${from}-${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="oklch(0.86 0.09 188 / 0.26)"
                strokeWidth="1"
                strokeDasharray="2 8"
                strokeLinecap="round"
                className="signal-edge"
                style={{ animationDelay: `${index * 460}ms` }}
              />
            )
          })}

          {NODES.map((node, index) => (
            <g key={index}>
              <circle cx={node.x} cy={node.y} r={node.r * (node.hero ? 9 : 5)} fill="oklch(0.79 0.115 187 / 0.07)" />
              {node.hero ? (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r * 2.6}
                  fill="none"
                  stroke="oklch(0.86 0.1 188 / 0.35)"
                  strokeWidth="1"
                  className="signal-ring"
                />
              ) : null}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={node.hero ? "oklch(0.92 0.1 188)" : "oklch(0.86 0.09 188)"}
                className="signal-node"
                style={{ animationDelay: `${index * 320}ms` }}
              />
            </g>
          ))}
        </g>
      </svg>

      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-[oklch(0.17_0.02_240)] via-[oklch(0.17_0.02_240)/0.55] to-transparent p-10 pt-24">
        <div className="flex items-center gap-2 text-[0.625rem] font-medium uppercase tracking-[0.18em] text-white/40">
          <span className="size-1 rounded-full bg-primary" />
          {t("next.login.liveTelemetry")}
        </div>
        <p className="mt-2 max-w-sm text-[0.8125rem] leading-relaxed text-white/55">
          {t("next.login.fieldTagline")}
        </p>
      </div>

      <style>{`
        .signal-node { animation: signal-pulse 4.2s ease-in-out infinite; }
        .signal-ring { animation: signal-breathe 6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        .signal-edge { animation: signal-flow 7s linear infinite; }
        @keyframes signal-pulse { 0%, 100% { opacity: .5 } 50% { opacity: 1 } }
        @keyframes signal-breathe { 0%, 100% { opacity: .18; transform: scale(.92) } 50% { opacity: .5; transform: scale(1.06) } }
        @keyframes signal-flow { to { stroke-dashoffset: -50 } }
        @media (prefers-reduced-motion: reduce) {
          .signal-node, .signal-edge, .signal-ring { animation: none }
        }
      `}</style>
    </div>
  )
}
