import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import DashboardService from '#services/dashboard_service'

@inject()
export default class DashboardsController {
  constructor(protected dashboardService: DashboardService) {}

  async health({ response }: HttpContext) {
    const health = await this.dashboardService.getHealthStatus()
    return response.json(health)
  }

  async index({ view }: HttpContext) {
    const data = await this.dashboardService.getDashboardData()
    return view.render('pages/cms/dashboard', data)
  }
}