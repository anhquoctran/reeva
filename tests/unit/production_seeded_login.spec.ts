import { test } from '@japa/runner'
import User from '#models/user'
import env from '#start/env'

const seededRootLogin = test('production seed root credentials authenticate', async ({
  assert,
}) => {
  const email = env.get('ADMIN_EMAIL')?.trim().toLowerCase()
  const password = env.get('ADMIN_PASSWORD')
  assert.isString(email)
  assert.isString(password)

  const user = await User.verifyCredentials(email!, password!)
  assert.isTrue(user.isActive)
  assert.isTrue(user.isRoot)
})

seededRootLogin.skip(
  !env.get('ADMIN_EMAIL') || !env.get('ADMIN_PASSWORD'),
  'Only runs when a synthetic root account is configured for production smoke.'
)
