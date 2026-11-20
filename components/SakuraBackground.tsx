'use client'

import { useEffect, useRef } from 'react'

type Petal = {
  x: number
  y: number
  size: number
  angle: number
  spin: number
  speedY: number
  speedX: number
  sway: number
  swayPhase: number
  opacity: number
  colorIndex: number
}

const COLORS = ['#f9c3d3', '#f4a7bd', '#fbe0e8', '#ee8fab', '#f7cad8']
const MAX_PETALS = 40
const REDUCED_MOTION_PETALS = 8

export default function SakuraBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = window.innerWidth
    let height = window.innerHeight
    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    let petals: Petal[] = []
    let rafId = 0
    let lastTime = 0

    const random = (min: number, max: number) => min + Math.random() * (max - min)

    // Exact viewport-driven formula; reduced motion keeps a small static set.
    const petalCount = () => {
      const base = Math.min(Math.floor(width / 25), MAX_PETALS)
      return reducedMotion ? Math.min(base, REDUCED_MOTION_PETALS) : base
    }

    const makePetal = (initial: boolean): Petal => {
      const size = random(6, 14)
      return {
        x: random(0, width),
        y: initial ? random(-height, height) : random(-80, -10),
        size,
        angle: random(0, Math.PI * 2),
        spin: random(-0.012, 0.012),
        speedY: random(0.25, 0.9) * (size / 10),
        speedX: random(-0.25, 0.25),
        sway: random(0.2, 0.9),
        swayPhase: random(0, Math.PI * 2),
        opacity: random(0.35, 0.8),
        colorIndex: Math.floor(random(0, COLORS.length)),
      }
    }

    // Sakura petal: two lobes joined by an inward V notch at the tip.
    const drawPetal = (petal: Petal) => {
      const s = petal.size
      ctx.save()
      ctx.translate(petal.x, petal.y)
      ctx.rotate(petal.angle)
      ctx.globalAlpha = petal.opacity
      ctx.fillStyle = COLORS[petal.colorIndex]
      ctx.beginPath()
      ctx.moveTo(0, s)
      ctx.bezierCurveTo(-s * 0.9, s * 0.4, -s * 0.78, -s * 0.8, -s * 0.22, -s)
      ctx.lineTo(0, -s * 0.72) // notch dip
      ctx.lineTo(s * 0.22, -s)
      ctx.bezierCurveTo(s * 0.78, -s * 0.8, s * 0.9, s * 0.4, 0, s)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height)
      for (const petal of petals) drawPetal(petal)
    }

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const target = petalCount()
      if (petals.length > target) petals = petals.slice(0, target)
      while (petals.length < target) petals.push(makePetal(true))
      // Resizing clears the backing store; under reduced motion nothing else
      // would redraw, so repaint the static frame right here.
      if (reducedMotion) render()
    }

    const step = (now: number) => {
      // Frame-rate independent: advance by elapsed time relative to 60 FPS.
      const dt = lastTime ? Math.min(now - lastTime, 50) / 16.667 : 1
      lastTime = now

      ctx.clearRect(0, 0, width, height)
      for (const petal of petals) {
        petal.angle += petal.spin * dt
        petal.y += petal.speedY * dt
        petal.swayPhase += 0.01 * dt
        petal.x += (petal.speedX + Math.sin(petal.swayPhase) * petal.sway) * dt
        if (petal.y > height + petal.size * 2) {
          Object.assign(petal, makePetal(false))
        }
        if (petal.x < -60) petal.x = width + 40
        if (petal.x > width + 60) petal.x = -40
        drawPetal(petal)
      }
      rafId = requestAnimationFrame(step)
    }

    resize()
    window.addEventListener('resize', resize)

    if (reducedMotion) {
      render()
    } else {
      rafId = requestAnimationFrame(step)
    }

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  )
}
