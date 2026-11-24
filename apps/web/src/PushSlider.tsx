// Push sensitivity (home Settings and the Esc menu): how big a push toward the camera has to be.
// A button that cycles through the sizes, like the other menu settings.
import { useState } from 'react'
import { PUSH_SIZES, getPushGrowth, nearestPush, setPushGrowth } from './settings'

export function PushSlider() {
  const [size, setSize] = useState(() => nearestPush(getPushGrowth()))
  return (
    <button
      onClick={() => {
        const next = PUSH_SIZES[(PUSH_SIZES.indexOf(size) + 1) % PUSH_SIZES.length]
        setSize(next)
        setPushGrowth(next.growth)
      }}
    >
      Push: {size.name}
    </button>
  )
}
