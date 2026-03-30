import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'session.forgot_password': { paramsTuple?: []; params?: {} }
    'session.password_recovery': { paramsTuple?: []; params?: {} }
    'session.reset_password': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'session.update_password': { paramsTuple?: []; params?: {} }
    'home': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'cms.dashboard': { paramsTuple?: []; params?: {} }
    'cms.dashboard.health': { paramsTuple?: []; params?: {} }
    'cms.versions.index': { paramsTuple?: []; params?: {} }
    'cms.versions.create': { paramsTuple?: []; params?: {} }
    'cms.versions.store': { paramsTuple?: []; params?: {} }
    'cms.versions.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.versions.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.versions.toggle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.versions.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.index': { paramsTuple?: []; params?: {} }
    'cms.artifacts.create': { paramsTuple?: []; params?: {} }
    'cms.artifacts.store': { paramsTuple?: []; params?: {} }
    'cms.artifacts.details': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.rebuild-all': { paramsTuple?: []; params?: {} }
    'cms.artifacts.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.publish': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.storage.index': { paramsTuple?: []; params?: {} }
    'cms.storage.activate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.storage.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.storage.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.settings.index': { paramsTuple?: []; params?: {} }
    'cms.settings.store': { paramsTuple?: []; params?: {} }
    'cms.settings.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.settings.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.profile.index': { paramsTuple?: []; params?: {} }
    'cms.profile.update': { paramsTuple?: []; params?: {} }
    'cms.profile.password': { paramsTuple?: []; params?: {} }
    'cms.users.index': { paramsTuple?: []; params?: {} }
    'cms.users.create': { paramsTuple?: []; params?: {} }
    'cms.users.store': { paramsTuple?: []; params?: {} }
    'cms.users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.users.resetPassword': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.users.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.check.get': { paramsTuple?: []; params?: {} }
    'api.check.post': { paramsTuple?: []; params?: {} }
    'api.latest.get': { paramsTuple?: []; params?: {} }
    'api.latest.post': { paramsTuple?: []; params?: {} }
    'api.download': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  GET: {
    'session.create': { paramsTuple?: []; params?: {} }
    'session.forgot_password': { paramsTuple?: []; params?: {} }
    'session.reset_password': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'home': { paramsTuple?: []; params?: {} }
    'cms.dashboard': { paramsTuple?: []; params?: {} }
    'cms.dashboard.health': { paramsTuple?: []; params?: {} }
    'cms.versions.index': { paramsTuple?: []; params?: {} }
    'cms.versions.create': { paramsTuple?: []; params?: {} }
    'cms.versions.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.index': { paramsTuple?: []; params?: {} }
    'cms.artifacts.create': { paramsTuple?: []; params?: {} }
    'cms.artifacts.details': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.storage.index': { paramsTuple?: []; params?: {} }
    'cms.storage.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.settings.index': { paramsTuple?: []; params?: {} }
    'cms.profile.index': { paramsTuple?: []; params?: {} }
    'cms.users.index': { paramsTuple?: []; params?: {} }
    'cms.users.create': { paramsTuple?: []; params?: {} }
    'cms.users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.check.get': { paramsTuple?: []; params?: {} }
    'api.latest.get': { paramsTuple?: []; params?: {} }
    'api.download': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  HEAD: {
    'session.create': { paramsTuple?: []; params?: {} }
    'session.forgot_password': { paramsTuple?: []; params?: {} }
    'session.reset_password': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'home': { paramsTuple?: []; params?: {} }
    'cms.dashboard': { paramsTuple?: []; params?: {} }
    'cms.dashboard.health': { paramsTuple?: []; params?: {} }
    'cms.versions.index': { paramsTuple?: []; params?: {} }
    'cms.versions.create': { paramsTuple?: []; params?: {} }
    'cms.versions.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.index': { paramsTuple?: []; params?: {} }
    'cms.artifacts.create': { paramsTuple?: []; params?: {} }
    'cms.artifacts.details': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.storage.index': { paramsTuple?: []; params?: {} }
    'cms.storage.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.settings.index': { paramsTuple?: []; params?: {} }
    'cms.profile.index': { paramsTuple?: []; params?: {} }
    'cms.users.index': { paramsTuple?: []; params?: {} }
    'cms.users.create': { paramsTuple?: []; params?: {} }
    'cms.users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.check.get': { paramsTuple?: []; params?: {} }
    'api.latest.get': { paramsTuple?: []; params?: {} }
    'api.download': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  POST: {
    'session.store': { paramsTuple?: []; params?: {} }
    'session.password_recovery': { paramsTuple?: []; params?: {} }
    'session.update_password': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'cms.versions.store': { paramsTuple?: []; params?: {} }
    'cms.versions.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.versions.toggle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.versions.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.store': { paramsTuple?: []; params?: {} }
    'cms.artifacts.rebuild-all': { paramsTuple?: []; params?: {} }
    'cms.artifacts.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.artifacts.publish': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.storage.activate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.storage.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.settings.store': { paramsTuple?: []; params?: {} }
    'cms.settings.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.settings.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.profile.update': { paramsTuple?: []; params?: {} }
    'cms.profile.password': { paramsTuple?: []; params?: {} }
    'cms.users.store': { paramsTuple?: []; params?: {} }
    'cms.users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.users.resetPassword': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'cms.users.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.check.post': { paramsTuple?: []; params?: {} }
    'api.latest.post': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}