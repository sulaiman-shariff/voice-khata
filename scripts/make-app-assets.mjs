// Renders public/icon.svg into the source PNGs @capacitor/assets expects.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const svg = readFileSync('public/icon.svg')
const icon = (size) => sharp(svg, { density: 1200 }).resize(size, size).png().toBuffer()

await sharp(await icon(1024)).toFile('assets/icon.png')

for (const [file, bg] of [['splash.png', '#f7f4ee'], ['splash-dark.png', '#1c1a17']]) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
    .composite([{ input: await icon(800), gravity: 'center' }])
    .png()
    .toFile(`assets/${file}`)
}
console.log('assets written')
