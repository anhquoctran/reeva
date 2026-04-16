
require('@adonisjs/core/env').Ignitor
  .tap((app) => {
    app.booting(async () => {
      const db = await app.container.make('lucid.db')
      const User = (await import('#models/user')).default
      const hash = await app.container.make('hash.manager')
      
      const user = await User.first()
      if (!user) return console.log('no user')
      
      const oldHash = user.passwordHash
      console.log('Old Hash:', oldHash)
      
      user.passwordHash = await hash.make('newpass')
      await user.save()
      console.log('New Hash after save:', user.passwordHash)
      console.log('Are hashes different?', oldHash !== user.passwordHash)
      
      const u2 = await User.find(user.id)
      console.log('Hash in DB:', u2.passwordHash)
      process.exit()
    })
  })
  .boot()

