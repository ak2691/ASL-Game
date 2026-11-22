// Privacy: what the camera is used for and what (little) leaves the device. Keep this accurate
// whenever data handling changes (new uploads, analytics, accounts, recordings).
export function PrivacyPage({ onHome }: { onHome: () => void }) {
  return (
    <main className="page info-page">
      <div className="info-top">
        <h1 className="logo">Privacy</h1>
        <button className="small" onClick={onHome}>
          Home
        </button>
      </div>

      <section className="info-card">
        <h2>Your camera</h2>
        <ul className="info-list">
          <li>The game needs your camera to see your hand signs and drawings.</li>
          <li>Hand tracking runs inside your browser, on your device. We don't save any hand-tracking data.</li>
          <li>Your video is never recorded, saved or uploaded. Nobody else sees it, including us and your opponent.</li>
          <li>In online matches, your opponent only sees your element, your drawn lines and your spells.</li>
          <li>The camera turns off when you leave a match or close the page.</li>
        </ul>
      </section>
    </main>
  )
}
