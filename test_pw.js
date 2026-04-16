import { URL } from 'node:url'
import { Ignitor } from '@adonisjs/core/env'
import { randomBytes } from 'node:crypto'

new Ignitor(new URL('./', 'file://' + process.cwd() + '/'))
  .tap((app) => {
    app.booting(async () => {
      try {
        const User = (await import('#models/user')).default
        const hash = await app.container.make('hash.manager')
        
        let u = await User.findBy('email', 'admin@reeva.io')
        if (!u) { console.log('no admin'); process.exit(); }
        
        const newPass = randomBytes(8).toString('hex')
        u.passwordHash = await hash.make(newPass)
        await u.save()
        
        console.log('Saved newly hashed password:', u.passwordHash)
        
        const verifiedUser = await User.verifyCredentials('admin@reeva.io', newPass)
        console.log('Verify credentials MATCHED:', !!verifiedUser)
        
      } catch(e) {
        console.error('Error in script:', e)
      }
      process.exit()
    })
  })
  .boot()
