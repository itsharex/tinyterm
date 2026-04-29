import './LoadingBlocks.css'

const delays = [
  [0.18, 0.18],
  [0.09, 0.00, 0.00, 0.09],
  [0.09, 0.00, 0.00, 0.09],
  [0.18, 0.18],
]

export function LoadingBlocks({ className }: { className?: string }) {
  return (
    <div className={`lb-blocks${className ? ` ${className}` : ''}`}>
      {delays.map((rowDelays, rowIdx) => (
        <div key={rowIdx} className="lb-row">
          {rowDelays.map((d, i) => (
            <div key={i} className="lb-block" style={{ animationDelay: `${d}s` }} />
          ))}
        </div>
      ))}
    </div>
  )
}
