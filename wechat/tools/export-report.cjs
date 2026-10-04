// Development-only. Original path artwork, with no external fonts or images.
// Run with WWJ_SHARP_PATH pointing to a development copy of sharp.
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require(process.env.WWJ_SHARP_PATH || 'sharp')
const directory = path.resolve(__dirname, '../miniprogram/assets/report')
const digit = {
  0: 'M34 10 C12 10 9 34 9 64 C9 96 16 119 34 119 C54 119 60 91 60 64 C60 33 54 10 34 10 Z M29 18 C43 13 47 40 47 65 C47 91 43 111 35 112',
  1: 'M17 29 L39 11 L39 119 M22 119 L56 119 M32 17 L32 111',
  2: 'M10 34 C10 9 55 0 59 29 C63 55 40 66 24 86 L11 113 L60 113 L60 101 M17 119 L57 119',
  3: 'M10 17 C27 3 56 9 56 30 C56 47 42 55 30 57 C47 56 61 69 60 90 C59 122 24 128 10 107 M15 17 L22 17 M26 61 L35 61',
  4: 'M48 11 L11 82 L61 82 M46 11 L46 119 M33 119 L61 119 M39 79 L39 113',
  5: 'M58 11 L17 11 L13 58 C25 46 49 47 57 68 C75 111 32 135 11 107 M20 18 L56 18',
  6: 'M55 13 C29 1 12 31 10 72 C8 119 30 131 49 115 C71 95 61 57 38 57 C24 57 15 63 10 75 M20 90 C20 111 29 121 38 116',
  7: 'M9 12 L62 12 L28 119 M9 12 L9 27 M54 19 L22 112 M17 119 L40 119',
  8: 'M32 9 C4 8 6 47 32 58 C61 71 64 106 44 118 C11 137 -1 94 15 74 C39 46 63 43 57 22 C52 10 41 8 32 9 Z M23 66 C10 88 17 114 30 118',
  9: 'M59 55 C57 3 14 -3 10 40 C5 84 43 83 58 64 C59 100 43 128 17 116 M48 28 C39 8 22 8 18 28'
}
function svg(width, height, body) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>` }
async function asset(name, width, height, body) {
  const source = svg(width, height, body)
  const filename = path.join(directory, name + '.svg')
  let exists = true
  try { await fs.access(filename) } catch (_) { exists = false }
  // Keep hand edits to the editable SVG. --redraw explicitly restores the original path design.
  if (!exists || process.argv.includes('--redraw')) await fs.writeFile(filename, source)
  const metadata = await sharp(filename).metadata()
  await sharp(filename).resize(metadata.width * 3, metadata.height * 3).png().toFile(path.join(directory, name + '.png'))
}
async function main() {
  await fs.mkdir(directory, { recursive: true })
  for (let month = 1; month <= 12; month++) {
    const name = String(month).padStart(2, '0')
    await asset('month-' + name, 176, 138, `<g fill="none" stroke="#493B35" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="${digit[name[0]]}" transform="translate(7 4)"/><path d="${digit[name[1]]}" transform="translate(92 4)"/></g><path d="M9 131 L167 131" stroke="#D9CCBB"/>`)
  }
  // 每月一页, drawn as simple archival lettering; native text remains alongside it.
  await asset('masthead', 156, 36, `<g fill="none" stroke="#493B35" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5 L4 11 M7 8 L27 8 M8 13 L27 13 L25 28 L7 28 Z M17 13 L16 28 M3 20 L30 20 M12 16 L13 18 M21 23 L22 25"/><path d="M43 6 L63 6 L63 28 L58 28 M43 6 L43 22 L40 29 M43 13 L63 13 M43 20 L63 20"/><path d="M77 18 C84 17 96 19 106 17"/><path d="M121 6 L148 6 M135 6 L131 11 M125 12 L145 12 L145 25 M125 12 L125 25 M130 16 L140 16 M130 20 L140 20 M135 22 L135 27 M135 25 L126 31 M139 26 L147 31"/></g><path d="M4 35 L149 35" stroke="#D9CCBB" stroke-width=".6"/>`)
  await asset('archive-sketch', 130, 148, `<path d="M22 33 L99 27 L111 122 L31 128 Z" fill="#DDE4D7"/><path d="M42 12 L104 20 L98 99 L34 91 Z" fill="#FFFCF7" stroke="#845645" stroke-width="1.5"/><path d="M42 12 L56 14 L54 24 L40 22 Z" fill="#E7D6BD"/><g fill="none" stroke="#845645" stroke-width="1.4" stroke-linecap="round"><path d="M52 36 L90 41 M50 45 L79 49 M47 69 L88 74 M47 78 L71 81"/><path d="M21 62 L66 59 L75 72 L113 69 L116 124 L26 130 Z" fill="#FFFCF7"/><path d="M27 78 L108 73 M31 116 L110 110"/><path d="M42 92 L64 90 L65 102 L43 104 Z"/><path d="M80 96 L86 96 M91 95 L97 95"/><path d="M8 133 C30 137 53 134 74 135 C93 136 109 130 122 133" stroke="#D9CCBB"/></g><path d="M80 105 L105 102 L106 110 L82 113 Z" fill="#E8D1C8"/><g fill="none" stroke="#7B8F72" stroke-width="1.4" stroke-linecap="round"><path d="M112 57 C114 46 117 43 122 38 M118 47 C109 48 107 43 108 39 C114 37 118 39 118 47 M118 46 C125 46 128 41 126 36 C120 35 117 39 118 46"/></g>`)
  process.stdout.write('Report lettering and archive illustration exported @3x.\n')
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1 })
