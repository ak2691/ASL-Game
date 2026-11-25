// Push sensitivity (home Settings and the Esc menu): how much bigger your hand must look on camera
// (moved toward it) to throw or parry. A whole percent from 5 to 50.
import { useState } from 'react'
import { PUSH_MAX, PUSH_MIN, getPushGrowth, setPushGrowth } from './settings'

export function PushSlider() {
  const [pct, setPct] = useState(() => Math.round((getPushGrowth() - 1) * 100))
  return (
    <div className="push-setting">
      <label className="volume">
        Push
        <input
          type="range"
          min={PUSH_MIN}
          max={PUSH_MAX}
          step={1}
          value={pct}
          aria-label="Push size in percent"
          onChange={(e) => {
            const v = +e.target.value
            setPct(v)
            setPushGrowth(1 + v / 100)
          }}
        />
        <b className="push-pct">{pct}%</b>
      </label>
      <p className="push-hint">How much closer your hand moves to throw. Lower is easier but can go off by accident.</p>
    </div>
  )
}

/** Same setting in the in-match menu. */
export const PushChoice = PushSlider

