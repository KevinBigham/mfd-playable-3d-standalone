import { resolve } from 'node:path'
import { exportCommittedSaltpanShowcase } from '../src/server'

const outputFlag = process.argv.indexOf('--output-dir')
const outputDirectory = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined
if (outputFlag >= 0 && !outputDirectory) {
  console.error('--output-dir requires a directory')
  process.exit(2)
}

const result = await exportCommittedSaltpanShowcase(
  outputDirectory ? resolve(process.cwd(), outputDirectory) : undefined,
)
console.log(JSON.stringify({
  source: 'committed-pascal-semantic-scene',
  stadiumId: 'the-saltpan',
  output: result.path,
  hash: result.hash,
}, null, 2))
