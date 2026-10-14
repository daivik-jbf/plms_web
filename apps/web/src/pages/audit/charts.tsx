import styles from './Analytics.module.css';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  // Shown when the column is hovered, and in the table view.
  detail: string;
}

// Rounds a maximum up to 1, 2, 5 or 10 times a power of ten, so the axis ends on a tidy number.
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * power;
}

const WIDTH = 640;
const HEIGHT = 200;
const LEFT = 36;
const BOTTOM = 22;
const TOP = 8;

// Single-series column chart: one hue, thin rounded columns standing on the baseline, a quiet grid and the x labels
// thinned to first, middle and last. Every column has a hover title; the table view beside the chart has all numbers.
export function ColumnChart({ title, data, unit }: { title: string; data: BarDatum[]; unit: string }) {
  const max = niceMax(Math.max(0, ...data.map((item) => item.value)));
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const slot = (WIDTH - LEFT) / Math.max(data.length, 1);
  const barWidth = Math.max(2, Math.min(24, slot * 0.7));
  const ticks = [0, max / 2, max];
  const labelAt = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);

  return (
    <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}. The numbers are in the table below the chart.`}>
      {ticks.map((tick) => {
        const y = TOP + plotHeight - (tick / max) * plotHeight;
        return (
          <g key={tick}>
            <line x1={LEFT} x2={WIDTH} y1={y} y2={y} className={tick === 0 ? styles.axis : styles.gridLine} />
            <text x={LEFT - 6} y={y + 4} textAnchor="end" className={styles.tick}>
              {Number.isInteger(tick) ? tick : tick.toFixed(1)}
            </text>
          </g>
        );
      })}
      {data.map((item, index) => {
        const height = (item.value / max) * plotHeight;
        const x = LEFT + index * slot + (slot - barWidth) / 2;
        return (
          <g key={item.key}>
            {/* The hit area is the whole slot, taller than the mark, so thin columns are easy to hover. */}
            <rect x={LEFT + index * slot} y={TOP} width={slot} height={plotHeight} className={styles.hit}>
              <title>{`${item.detail}: ${item.value} ${unit}`}</title>
            </rect>
            {item.value > 0 ? (
              <rect
                x={x}
                y={TOP + plotHeight - height}
                width={barWidth}
                height={height}
                rx={Math.min(3, barWidth / 2)}
                className={styles.bar}
                pointerEvents="none"
              />
            ) : null}
            {labelAt.has(index) ? (
              <text
                x={x + barWidth / 2}
                y={HEIGHT - 6}
                textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
                className={styles.tick}
              >
                {item.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// Ranked horizontal bars with the number beside each: for names that are too long to sit under a column.
export function RankedBars({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const top = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className={styles.ranked}>
      {rows.map((row) => (
        <li key={row.key} className={styles.rankedRow}>
          <span className={styles.rankedLabel}>{row.label}</span>
          <span className={styles.track} aria-hidden="true">
            <span className={styles.fill} style={{ width: `${row.value > 0 ? Math.max(2, (row.value / top) * 100) : 0}%` }} />
          </span>
          <span className={styles.rankedValue}>{row.value.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

// The same numbers as text, for screen readers, for copying and for anyone who prefers a table.
export function DataTable({ summary, heading, rows }: { summary: string; heading: [string, string]; rows: [string, number][] }) {
  return (
    <details className={styles.details}>
      <summary>{summary}</summary>
      <div className={styles.scroll}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th scope="col">{heading[0]}</th>
              <th scope="col">{heading[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{value.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
