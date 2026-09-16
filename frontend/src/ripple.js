/* M3 涟漪：为 .ripple 元素生成点击/触摸涟漪 */
export function setupRipple(el) {
  const onPointer = (ev) => {
    const rect = el.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height) * 2
    const wave = document.createElement('span')
    wave.className = 'ripple-wave'
    wave.style.width = wave.style.height = size + 'px'
    const x = (ev.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2
    const y = (ev.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2
    wave.style.left = x + 'px'
    wave.style.top = y + 'px'
    el.appendChild(wave)
    wave.addEventListener('animationend', () => wave.remove(), { once: true })
  }
  el.addEventListener('pointerdown', onPointer)
  return () => el.removeEventListener('pointerdown', onPointer)
}
