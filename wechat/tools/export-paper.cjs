// Development-only exporter. Generated PNG files are committed; the app needs no Node dependency.
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require(process.env.WWJ_SHARP_PATH || 'sharp')
async function main() {
  const directory = path.resolve(__dirname, '../miniprogram/assets/paper')
  for (const name of (await fs.readdir(directory)).filter(name => name.endsWith('.svg')).sort()) {
    const source = path.join(directory, name)
    const metadata = await sharp(source).metadata()
    await sharp(source).resize(metadata.width * 3, metadata.height * 3).png().toFile(source.replace(/\.svg$/, '.png'))
    process.stdout.write(`${name} → PNG @3x\n`)
  }
  // WXSS cannot load packaged local images as CSS backgrounds. Keep only the tiny grain inline;
  // larger collages use native image components and the editable PNG files.
  const cssPath = path.resolve(directory, '../../app.wxss')
  const grain = (await fs.readFile(path.join(directory, 'grain.png'))).toString('base64')
  const css = await fs.readFile(cssPath, 'utf8')
  const updated = css.replace(/url\('data:image\/png;base64,[^']+'\)/, `url('data:image/png;base64,${grain}')`)
  if (updated !== css) await fs.writeFile(cssPath, updated)
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
