import fs from 'node:fs'
import path from 'node:path'

const distAssetsDir = path.resolve('dist/assets')
const entryMaxBytes = 600 * 1024

if (!fs.existsSync(distAssetsDir)) {
  console.error('Bundle check failed: dist/assets not found. Run npm run build first.')
  process.exit(1)
}

const files = fs.readdirSync(distAssetsDir)
const entryCandidates = files.filter(name => /^index-.*\.js$/.test(name))

if (entryCandidates.length === 0) {
  console.error('Bundle check failed: no entry bundle file like index-*.js found.')
  process.exit(1)
}

const oversized = []
for (const fileName of entryCandidates) {
  const filePath = path.join(distAssetsDir, fileName)
  const size = fs.statSync(filePath).size
  if (size > entryMaxBytes) {
    oversized.push({ fileName, size })
  }
}

if (oversized.length > 0) {
  console.error('Bundle budget exceeded (entry bundle max 600 KiB):')
  for (const item of oversized) {
    console.error(` - ${item.fileName}: ${(item.size / 1024).toFixed(2)} KiB`)
  }
  process.exit(1)
}

console.log('Bundle budget check passed.')
for (const fileName of entryCandidates) {
  const size = fs.statSync(path.join(distAssetsDir, fileName)).size
  console.log(` - ${fileName}: ${(size / 1024).toFixed(2)} KiB`)
}
