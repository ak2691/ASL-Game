// Opens the front camera at the highest frame rate it offers (60 fps where possible), not just 30.
//
// Asking for "1280x720, ideally 60 fps" let browsers keep 720p and give 30 fps when the camera can't
// do both, which most laptop webcams can't. Frame rate matters more than resolution here: hand
// tracking shrinks every frame to a small size anyway, and more frames mean smaller jumps between
// them on fast moves. So: open the camera, then, if it's under 50 fps, try 60 fps at a few
// resolutions (smallest first) and keep the first that works. Otherwise keep what it had.

const SIZES_FOR_60: [number, number][] = [
  [640, 360],
  [640, 480],
  [960, 540],
  [1280, 720],
]

export interface CameraInfo {
  fps: number
  width: number
  height: number
}

export async function openCamera(): Promise<{ stream: MediaStream; info: () => CameraInfo }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Front camera on phones. Turned sideways, the browser rotates the frames itself.
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  })
  const track = stream.getVideoTracks()[0]
  const fps = () => track.getSettings().frameRate ?? 0
  const maxFps = track.getCapabilities?.().frameRate?.max ?? 60
  if (fps() < 50 && maxFps >= 50) {
    const before = track.getConstraints()
    let done = false
    for (const [w, h] of SIZES_FOR_60) {
      try {
        await track.applyConstraints({ facingMode: 'user', width: { ideal: w }, height: { ideal: h }, frameRate: { min: 50, ideal: 60 } })
        if (fps() >= 50) {
          done = true
          break
        }
      } catch {
        /* not at this size: try the next */
      }
    }
    if (!done) await track.applyConstraints(before).catch(() => {})
  }
  return {
    stream,
    info: () => {
      const s = track.getSettings()
      return { fps: Math.round(s.frameRate ?? 0), width: s.width ?? 0, height: s.height ?? 0 }
    },
  }
}
