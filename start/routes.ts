/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import AutoSwagger from 'adonis-autoswagger'
import swaggerConfig from '#config/swagger'

// Swagger & Documentation
router.get('/swagger.json', async () => {
  // @ts-ignore
  return AutoSwagger.default.docs(router.toJSON(), swaggerConfig)
})

router.get('/docs', async ({ response }) => {
  // @ts-ignore
  return response.send(AutoSwagger.default.scalar('/swagger.json'))
})


// Explicitly import controllers
import DashboardsController from '#controllers/cms/dashboards_controller'
import VersionsController from '#controllers/cms/versions_controller'
import ArtifactsController from '#controllers/cms/artifacts_controller'
import StorageProvidersController from '#controllers/cms/storage_providers_controller'
import SettingsController from '#controllers/cms/settings_controller'
import ProfilesController from '#controllers/cms/profiles_controller'
import UsersController from '#controllers/cms/users_controller'
import SessionController from '#controllers/session_controller'

router
  .group(() => {
    router.get('login', [SessionController, 'create']).as('session.create')
    router.post('login', [SessionController, 'store']).as('session.store')
    router.get('forgot-password', [SessionController, 'forgotPassword']).as('session.forgot_password')
    router.post('forgot-password', [SessionController, 'sendResetLink']).as('session.password_recovery')
    router.get('reset-password/:token', [SessionController, 'resetPassword']).as('session.reset_password')
    router.post('reset-password', [SessionController, 'updatePassword']).as('session.update_password')
  })
  .use(middleware.guest())

router
  .group(() => {
    router.get('/', ({ response }) => response.redirect().toRoute('cms.dashboard')).as('home')
    router.post('logout', [SessionController, 'destroy']).as('session.destroy')

    // CMS Routes
    router
      .group(() => {
        router.get('/', [DashboardsController, 'index']).as('cms.dashboard')
        router.get('/dashboard/health', [DashboardsController, 'health']).as('cms.dashboard.health')

        router.get('/versions', [VersionsController, 'index']).as('cms.versions.index')
        router.get('/versions/create', [VersionsController, 'create']).as('cms.versions.create')
        router.post('/versions', [VersionsController, 'store']).as('cms.versions.store')
        router.get('/versions/:id/edit', [VersionsController, 'edit']).as('cms.versions.edit')
        router.post('/versions/:id', [VersionsController, 'update']).as('cms.versions.update')
        router.post('/versions/:id/toggle', [VersionsController, 'toggle']).as('cms.versions.toggle')
        router.post('/versions/:id/delete', [VersionsController, 'destroy']).as('cms.versions.destroy')

        router.get('/artifacts', [ArtifactsController, 'index']).as('cms.artifacts.index')
        router.get('/artifacts/create', [ArtifactsController, 'create']).as('cms.artifacts.create')
        router.post('/artifacts', [ArtifactsController, 'store']).as('cms.artifacts.store')
        router.get('/artifacts/:id/details', [ArtifactsController, 'details']).as('cms.artifacts.details')
        router.post('/artifacts/rebuild-all', [ArtifactsController, 'rebuildAllNames']).as('cms.artifacts.rebuild-all')
        router.get('/artifacts/:id/edit', [ArtifactsController, 'edit']).as('cms.artifacts.edit')
        router.post('/artifacts/:id', [ArtifactsController, 'update']).as('cms.artifacts.update')
        router.post('/artifacts/:id/delete', [ArtifactsController, 'destroy']).as('cms.artifacts.destroy')
        router.post('/artifacts/:id/publish', [ArtifactsController, 'publish']).as('cms.artifacts.publish')

        router.get('/storage', [StorageProvidersController, 'index']).as('cms.storage.index')
        router.post('/storage/:id/activate', [StorageProvidersController, 'activate']).as('cms.storage.activate')
        router.get('/storage/:id/edit', [StorageProvidersController, 'edit']).as('cms.storage.edit')
        router.post('/storage/:id', [StorageProvidersController, 'update']).as('cms.storage.update')

        router.get('/settings', [SettingsController, 'index']).as('cms.settings.index')
        router.post('/settings', [SettingsController, 'store']).as('cms.settings.store')
        router.post('/settings/:id', [SettingsController, 'update']).as('cms.settings.update')
        router.post('/settings/:id/delete', [SettingsController, 'destroy']).as('cms.settings.destroy')

        router.get('/profile', [ProfilesController, 'index']).as('cms.profile.index')
        router.post('/profile', [ProfilesController, 'update']).as('cms.profile.update')
        router.post('/profile/password', [ProfilesController, 'changePassword']).as('cms.profile.password')

        router.get('/users', [UsersController, 'index']).as('cms.users.index')
        router.get('/users/create', [UsersController, 'create']).as('cms.users.create')
        router.post('/users', [UsersController, 'store']).as('cms.users.store')
        router.get('/users/:id/edit', [UsersController, 'edit']).as('cms.users.edit')
        router.post('/users/:id', [UsersController, 'update']).as('cms.users.update')
        router.post('/users/:id/reset-password', [UsersController, 'resetPassword']).as('cms.users.resetPassword')
        router.post('/users/:id/delete', [UsersController, 'destroy']).as('cms.users.destroy')
      })
      .prefix('/cms')
  })
  .use(middleware.auth())

// API Routes
router
  .group(() => {
    router.get('/check', '#controllers/api/updater_controller.check').as('api.check.get')
    router.post('/check', '#controllers/api/updater_controller.check').as('api.check.post')
    
    router.get('/latest', '#controllers/api/updater_controller.latest').as('api.latest.get')
    router.post('/latest', '#controllers/api/updater_controller.latest').as('api.latest.post')
    
    router.get('/download/:id', '#controllers/api/updater_controller.download').as('api.download')
  })
  .prefix('/api')

// Serving local storage files (Proxied or Direct)
router.get('/storage/files/*', async ({ request, response }) => {
  const key = request.param('*').join('/')
  const StorageProvider = (await import('#models/storage_provider')).default
  const path = await import('node:path')
  const provider = await StorageProvider.query().where('type', 'local').first()

  if (!provider) return response.status(404).send('Not Found')

  const root = (provider.config as any)?.root || path.join(process.cwd(), 'storage', 'uploads')
  const filePath = path.join(root, key)

  return response.download(filePath)
})
