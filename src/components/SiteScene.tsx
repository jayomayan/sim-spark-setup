import type { CSSProperties, ReactNode } from "react";

/**
 * Line-art "connected site" scene: a central lattice tower with the
 * equipment around it (generator, cameras, building, fuel, batteries,
 * access control, lighting, perimeter) wired back to the tower.
 * Strokes use brand tokens so it themes with the rest of the app.
 */
export function SiteScene({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const ink = "var(--foreground)";
  const red = "var(--primary)";
  const orange = "var(--chart-2)";
  const amber = "var(--chart-3)";

  // ---- tower geometry ----
  const CX = 800;
  const TOP = 150;
  const BASE = 860;
  const LEVELS = 7;
  const HALF_TOP = 26;
  const HALF_BASE = 64;
  const ys = Array.from({ length: LEVELS + 1 }, (_, i) => BASE + ((TOP - BASE) * i) / LEVELS);
  const halfAt = (y: number) => HALF_TOP + ((HALF_BASE - HALF_TOP) * (y - TOP)) / (BASE - TOP);
  const lx = (y: number) => CX - halfAt(y);
  const rx = (y: number) => CX + halfAt(y);

  const Wifi = ({ x, y }: { x: number; y: number }) => (
    <g stroke={amber} strokeWidth="3" strokeLinecap="round" fill="none">
      {[10, 20, 30].map((r) => (
        <path key={r} d={`M ${x - r} ${y} A ${r} ${r} 0 0 1 ${x + r} ${y}`} />
      ))}
      <circle cx={x} cy={y + 6} r="3.5" fill={amber} stroke="none" />
    </g>
  );

  const Label = ({ x, y, lines }: { x: number; y: number; lines: string[] }) => (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fill={ink}
      fontSize="13"
      letterSpacing="1.5"
      style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase" }}
    >
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 16}>
          {l}
        </tspan>
      ))}
    </text>
  );

  /** elbow connector: device bottom -> down -> across to the tower base */
  const Wire = ({ x, from, elbow }: { x: number; from: number; elbow: number }) => (
    <path
      d={`M ${x} ${from} V ${elbow} H ${CX}`}
      stroke={orange}
      strokeWidth="2.5"
      fill="none"
      opacity={0.75}
    />
  );

  return (
    <svg viewBox="0 0 1600 900" fill="none" aria-hidden="true" className={className} style={style}>
      {/* ================= central tower ================= */}
      <g>
        {/* signal arcs */}
        {[34, 58, 82].map((r, i) => (
          <path
            key={r}
            d={`M ${CX - r} 66 A ${r} ${r} 0 0 1 ${CX + r} 66`}
            stroke={i === 0 ? amber : orange}
            strokeWidth="3"
            strokeLinecap="round"
            opacity={0.9 - i * 0.25}
          />
        ))}
        <circle cx={CX} cy={66} r="5" fill={orange} />
        {/* mast */}
        <line x1={CX} y1={TOP} x2={CX} y2={72} stroke={red} strokeWidth="3.5" />
        {/* legs */}
        <line x1={lx(BASE)} y1={BASE} x2={lx(TOP)} y2={TOP} stroke={red} strokeWidth="4" />
        <line x1={rx(BASE)} y1={BASE} x2={rx(TOP)} y2={TOP} stroke={red} strokeWidth="4" />
        {/* rungs + X braces */}
        {ys.map((y, i) => (
          <line key={`r${i}`} x1={lx(y)} y1={y} x2={rx(y)} y2={y} stroke={red} strokeWidth="2.25" opacity={0.9} />
        ))}
        {ys.slice(0, -1).map((y, i) => {
          const y2 = ys[i + 1] ?? y;
          return (
            <g key={`b${i}`} opacity={0.45}>
              <line x1={lx(y)} y1={y} x2={rx(y2)} y2={y2} stroke={red} strokeWidth="1.75" />
              <line x1={rx(y)} y1={y} x2={lx(y2)} y2={y2} stroke={red} strokeWidth="1.75" />
            </g>
          );
        })}
        {/* antenna crossarms */}
        {[235, 340].map((y) => (
          <g key={y}>
            <line x1={lx(y) - 62} y1={y} x2={rx(y) + 62} y2={y} stroke={red} strokeWidth="3" />
            <rect x={lx(y) - 70} y={y - 26} width="8" height="26" fill={orange} />
            <rect x={rx(y) + 62} y={y - 26} width="8" height="26" fill={orange} />
          </g>
        ))}
        {/* ground */}
        <line x1={CX - 130} y1={BASE} x2={CX + 130} y2={BASE} stroke={red} strokeWidth="3" opacity={0.7} />
      </g>

      {/* ================= left side ================= */}
      {/* generator */}
      <g stroke={ink} strokeWidth="2.5">
        <Label x={140} y={462} lines={["Generator", "Monitoring"]} />
        <Wifi x={140} y={522} />
        <rect x="92" y="592" width="96" height="66" rx="6" />
        <rect x="120" y="578" width="12" height="14" />
        <rect x="102" y="604" width="28" height="20" stroke={amber} />
        <circle cx="152" cy="614" r="8" />
        <circle cx="174" cy="614" r="8" />
        <line x1="102" y1="640" x2="178" y2="640" stroke={amber} />
        <circle cx="110" cy="668" r="7" />
        <circle cx="170" cy="668" r="7" />
      </g>
      <Wire x={140} from={675} elbow={792} />

      {/* cctv camera */}
      <g stroke={ink} strokeWidth="2.5">
        <Label x={360} y={462} lines={["Camera", "Surveillance"]} />
        <Wifi x={360} y={522} />
        <line x1="345" y1="560" x2="345" y2="586" />
        <rect x="330" y="552" width="30" height="9" />
        <rect x="322" y="586" width="64" height="30" rx="8" />
        <circle cx="392" cy="601" r="10" stroke={amber} />
        <line x1="336" y1="616" x2="336" y2="628" />
        <line x1="372" y1="616" x2="372" y2="628" />
      </g>
      <Wire x={360} from={628} elbow={806} />

      {/* building automation */}
      <g stroke={ink} strokeWidth="2.5">
        <Label x={545} y={462} lines={["Building", "Automation"]} />
        <Wifi x={545} y={522} />
        <rect x="508" y="566" width="74" height="102" />
        {[0, 1, 2].map((c) =>
          [0, 1, 2, 3].map((r) => (
            <rect
              key={`${c}${r}`}
              x={516 + c * 22}
              y={576 + r * 20}
              width="12"
              height="12"
              fill={amber}
              stroke="none"
              opacity={0.65}
            />
          )),
        )}
        <rect x="536" y="640" width="18" height="28" />
      </g>
      <Wire x={545} from={668} elbow={820} />

      {/* fuel tank */}
      <g stroke={ink} strokeWidth="2.5">
        <Label x={686} y={462} lines={["Fuel Level", "Monitoring"]} />
        <Wifi x={672} y={522} />
        <rect x="628" y="596" width="88" height="46" rx="23" />
        <circle cx="672" cy="586" r="9" stroke={amber} />
        <line x1="640" y1="619" x2="704" y2="619" stroke={amber} />
        <line x1="644" y1="642" x2="638" y2="668" />
        <line x1="700" y1="642" x2="706" y2="668" />
      </g>
      <Wire x={672} from={668} elbow={834} />

      {/* ================= right side ================= */}
      {/* power & battery */}
      <g stroke={ink} strokeWidth="2.5">
        <Label x={930} y={462} lines={["Power &", "Battery"]} />
        <Wifi x={945} y={522} />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={908} y={566 + i * 34} width="74" height="28" rx="4" />
            <polyline
              points={`${941},${572 + i * 34} ${935},${582 + i * 34} ${945},${582 + i * 34} ${939},${592 + i * 34}`}
              stroke={amber}
              fill="none"
            />
            <rect x={916} y={560 + i * 34} width="10" height="6" />
          </g>
        ))}
      </g>
      <Wire x={945} from={668} elbow={834} />

      {/* access control */}
      <g stroke={ink} strokeWidth="2.5">
        <Label x={1115} y={462} lines={["Access", "Control"]} />
        <Wifi x={1115} y={522} />
        <rect x="1078" y="566" width="74" height="96" rx="6" />
        <rect x="1088" y="576" width="54" height="18" stroke={amber} />
        {[0, 1, 2].map((c) =>
          [0, 1, 2].map((r) => (
            <rect key={`${c}${r}`} x={1090 + c * 18} y={604 + r * 16} width="9" height="9" />
          )),
        )}
      </g>
      <Wire x={1115} from={662} elbow={820} />

      {/* automated lighting */}
      <g stroke={ink} strokeWidth="2.5">
        <Label x={1305} y={462} lines={["Automated", "Lighting"]} />
        <Wifi x={1305} y={522} />
        <circle cx="1305" cy="596" r="27" />
        <path d="M1296 590 q9 12 18 0" stroke={amber} />
        <line x1="1292" y1="628" x2="1318" y2="628" />
        <line x1="1294" y1="636" x2="1316" y2="636" />
        {[-40, -20, 0, 20, 40].map((a) => {
          const rad = ((a - 90) * Math.PI) / 180;
          const x1 = 1305 + Math.cos(rad) * 36;
          const y1 = 596 + Math.sin(rad) * 36;
          const x2 = 1305 + Math.cos(rad) * 46;
          const y2 = 596 + Math.sin(rad) * 46;
          return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke={amber} />;
        })}
      </g>
      <Wire x={1305} from={644} elbow={806} />

      {/* perimeter defence */}
      <g stroke={ink} strokeWidth="2.5">
        <Label x={1476} y={462} lines={["Perimeter", "Defence"]} />
        <Wifi x={1480} y={522} />
        <line x1="1480" y1="560" x2="1480" y2="640" />
        <rect x="1452" y="552" width="56" height="24" rx="5" />
        <circle cx="1512" cy="564" r="8" stroke={amber} />
        <line x1="1428" y1="640" x2="1532" y2="640" />
        <line x1="1428" y1="662" x2="1532" y2="662" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line x1={1432 + i * 26} y1="640" x2={1458 + i * 26} y2="662" />
            <line x1={1458 + i * 26} y1="640" x2={1432 + i * 26} y2="662" />
          </g>
        ))}
      </g>
      <Wire x={1480} from={662} elbow={792} />
    </svg>
  );
}
