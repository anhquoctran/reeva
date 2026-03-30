import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default {
  path: path.join(__dirname, '../'),
  appPath: path.join(__dirname, '../app/controllers'),
  title: 'Reeva OTA API Documentation',
  version: '1.0.0',
  description: 'Dynamic Over-the-Air Update Infrastructure Distribution API Specification',
  tagIndex: 2,
  snakeCase: true,
  ignore: ['/cms', '/login', '/logout', '/storage'],
  preferredPutPatch: 'PUT',
  common: {
    parameters: [],
    headers: [],
  },
  persistAuthorization: true,
  debug: true
}
