// Game-style scrolling (Nov 26): panels that scroll show no browser scrollbar (it reads as a website).
// Instead, when there's more below, the panel gets `more-below`: a soft fade at its bottom edge and a small
// bouncing arrow (App.css). One watcher for the whole app: it checks scrolling panels when they scroll,
// when the window resizes, and every half second (content changes, panels opening).
const PANELS = '.tut-body, .tutorial, .dm-body, .menu-card, .book-leaf.right, .tower-wrap .tower, .lobby-screen'

function check(el: Element) {
  const e = el as HTMLElement
  const more = e.scrollHeight - e.clientHeight - e.scrollTop > 6
  e.classList.toggle('more-below', more)
}
const checkAll = () => document.querySelectorAll(PANELS).forEach(check)

if (typeof window !== 'undefined') {
  document.addEventListener('scroll', (ev) => ev.target instanceof Element && ev.target.matches(PANELS) && check(ev.target), { capture: true, passive: true })
  window.addEventListener('resize', checkAll)
  setInterval(checkAll, 500)
}
