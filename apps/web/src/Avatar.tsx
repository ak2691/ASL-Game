// A player's picture (Nov 28): the first letter of their name on a color picked from the name, so it's the same
// everywhere. Stands in until uploaded pictures and a drawn default exist (the AI wizard portraits are only for
// the Tower's opponents). Takes the same `.portrait` class, so it fits wherever a portrait went.
const COLORS = ['#6c63ff', '#ff6a3d', '#2fb8a0', '#e0a21c', '#d6457a', '#4b8be8', '#8a5cd6', '#3fa34d']

export function Avatar({ name }: { name: string | null | undefined }) {
  const n = (name ?? '').trim()
  let h = 0
  for (const ch of n.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span className="portrait avatar" style={{ background: COLORS[h % COLORS.length] }} aria-hidden="true">
      <span>{(n[0] ?? '?').toUpperCase()}</span>
    </span>
  )
}
