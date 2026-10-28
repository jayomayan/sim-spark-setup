import type { CSSProperties } from "react";

/**
 * Wireframe lattice tower drawn as an SVG so it stays crisp at any size
 * and picks up the brand tokens (deep red / orange) from the theme.
 */
export function TowerWireframe({
  className,
  style,
  back = false,
}: {
  className?: string;
  style?: CSSProperties;
  /** Draw a recessed second face + connecting edges for a 3D lattice look. */
  back?: boolean;
}) {
  const LEVELS = 10;
  const TOP = 130;
  const BASE = 880;
  const CX = 300;
  const HALF_TOP = 30;
  const HALF_BASE = 168;

  const ys = Array.from({ length: LEVELS + 1 }, (_, i) => BASE + ((TOP - BASE) * i) / LEVELS);
  const halfAt = (y: number) => HALF_TOP + ((HALF_BASE - HALF_TOP) * (y - TOP)) / (BASE - TOP);
  const lx = (y: number) => CX - halfAt(y);
  const rx = (y: number) => CX + halfAt(y);

  const red = "var(--chart-1)";
  const orange = "var(--chart-2)";
  const amber = "var(--chart-3)";

  const BX = 86; // back-face horizontal offset
  const BY = 34; // back-face vertical offset (raised = seen from slightly below)

  return (
    <svg viewBox="0 0 600 940" fill="none" aria-hidden="true" className={className} style={style}>
      {back && (
        <g opacity={0.42}>
          {/* recessed rear face, narrower to fake perspective */}
          <g transform={`translate(${BX} ${BY}) scale(0.82 1) translate(${CX * 0.18} 0)`}>
            <line x1={lx(BASE)} y1={BASE} x2={lx(TOP)} y2={TOP} stroke={red} strokeWidth="3" />
            <line x1={rx(BASE)} y1={BASE} x2={rx(TOP)} y2={TOP} stroke={red} strokeWidth="3" />
            {ys.map((y, i) => (
              <line key={`b-rung-${i}`} x1={lx(y)} y1={y} x2={rx(y)} y2={y} stroke={red} strokeWidth="1.75" opacity={0.85} />
            ))}
            {ys.slice(0, -1).map((y, i) => {
              const y2 = ys[i + 1] ?? y;
              return (
                <g key={`b-brace-${i}`} opacity={0.4}>
                  <line x1={lx(y)} y1={y} x2={rx(y2)} y2={y2} stroke={red} strokeWidth="1.5" />
                  <line x1={rx(y)} y1={y} x2={lx(y2)} y2={y2} stroke={red} strokeWidth="1.5" />
                </g>
              );
            })}
          </g>
          {/* edges connecting front face to rear face at every rung */}
          {ys.map((y, i) => {
            const s = 0.82;
            const bx = (x: number) => BX + CX * 0.18 + x * s;
            return (
              <g key={`depth-${i}`} opacity={0.5}>
                <line x1={lx(y)} y1={y} x2={bx(lx(y))} y2={y + BY} stroke={red} strokeWidth="1.75" />
                <line x1={rx(y)} y1={y} x2={bx(rx(y))} y2={y + BY} stroke={red} strokeWidth="1.75" />
              </g>
            );
          })}
          {/* mast depth edge */}
          <line x1={CX} y1={TOP} x2={CX * 1.18 + BX * 0.82} y2={TOP + BY} stroke={red} strokeWidth="2" opacity={0.5} />
        </g>
      )}
      {/* signal arcs above the mast */}
      {[46, 76, 106].map((r, i) => (
        <path
          key={r}
          d={`M ${CX - r} 118 A ${r} ${r} 0 0 1 ${CX + r} 118`}
          stroke={i === 0 ? amber : orange}
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity={0.85 - i * 0.22}
        />
      ))}
      <circle cx={CX} cy={118} r="5" fill={orange} />

      {/* mast + antennas */}
      <line x1={CX} y1={TOP} x2={CX} y2={70} stroke={red} strokeWidth="3" />
      <line x1={CX - 26} y1={104} x2={CX + 26} y2={104} stroke={red} strokeWidth="2.5" />
      <line x1={CX - 34} y1={130} x2={CX + 34} y2={130} stroke={red} strokeWidth="2.5" />
      <rect x={CX - 30} y={96} width="6" height="16" fill={orange} />
      <rect x={CX + 24} y={96} width="6" height="16" fill={orange} />
      <rect x={CX - 40} y={122} width="6" height="16" fill={amber} />
      <rect x={CX + 34} y={122} width="6" height="16" fill={amber} />

      {/* legs */}
      <line x1={lx(BASE)} y1={BASE} x2={lx(TOP)} y2={TOP} stroke={red} strokeWidth="3.5" />
      <line x1={rx(BASE)} y1={BASE} x2={rx(TOP)} y2={TOP} stroke={red} strokeWidth="3.5" />

      {/* rungs and X braces per segment */}
      {ys.map((y, i) => (
        <line
          key={`rung-${i}`}
          x1={lx(y)}
          y1={y}
          x2={rx(y)}
          y2={y}
          stroke={red}
          strokeWidth={i === LEVELS ? 2 : 2}
          opacity={0.9}
        />
      ))}
      {ys.slice(0, -1).map((y, i) => {
        const y2 = ys[i + 1] ?? y;
        return (
          <g key={`brace-${i}`} opacity={0.4}>
            <line x1={lx(y)} y1={y} x2={rx(y2)} y2={y2} stroke={red} strokeWidth="1.75" />
            <line x1={rx(y)} y1={y} x2={lx(y2)} y2={y2} stroke={red} strokeWidth="1.75" />
          </g>
        );
      })}

      {/* crossarm with sector antennas mid-tower */}
      {(() => {
        const midY = ys[5] ?? BASE;
        return (
          <g>
            <line x1={lx(midY) - 46} y1={midY} x2={rx(midY) + 46} y2={midY} stroke={red} strokeWidth="2.5" />
            <rect x={lx(midY) - 52} y={midY - 16} width="6" height="16" fill={orange} />
            <rect x={rx(midY) + 46} y={midY - 16} width="6" height="16" fill={orange} />
          </g>
        );
      })()}

      {/* ground pad */}
      <line x1={lx(BASE) - 40} y1={BASE} x2={rx(BASE) + 40} y2={BASE} stroke={red} strokeWidth="3" opacity="0.7" />
      <line x1={lx(BASE) - 12} y1={BASE + 18} x2={rx(BASE) + 12} y2={BASE + 18} stroke={red} strokeWidth="2" opacity="0.45" />
    </svg>
  );
}
