// Volume slider (used on the home page and in the Esc menu). Saved between visits by sfx.ts.
import { useState } from 'react'
import { getVolume, play, setVolume } from './sfx'

export function VolumeSlider() {
  const [vol, setVol] = useState(getVolume)
  return (
    <label className="volume">
      Volume
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(vol * 100)}
        aria-label="Volume"
        onChange={(e) => {
          const v = +e.target.value / 100
          setVol(v)
          setVolume(v)
        }}
        onPointerUp={() => play('charge_F', { vol: 0.6 })}
      />
    </label>
  )
}

/** The same setting as a segmented gauge (the in-match menu). */
export function VolumeMeter() {
  const [vol, setVol] = useState(getVolume)
  const p = (Math.round(vol * 12) / 12) * 100
  return (
    <input
      className="dm-meter"
      type="range"
      min={0}
      max={100}
      value={Math.round(vol * 100)}
      aria-label="Volume"
      style={{ '--p': `${p}%` } as React.CSSProperties}
      onChange={(e) => {
        const v = +e.target.value / 100
        setVol(v)
        setVolume(v)
      }}
      onPointerUp={() => play('charge_F', { vol: 0.6 })}
    />
  )
}
