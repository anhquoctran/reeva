import User from '#models/user'

export default class UserRepository {
  async paginate(page: number, limit: number) {
    return await User.query().orderBy('createdAt', 'asc').paginate(page, limit)
  }

  async findByEmail(email: string) {
    return await User.findBy('email', email)
  }

  async create(data: Partial<User>) {
    return await User.create(data)
  }

  async findById(id: string | number) {
    return await User.findOrFail(id)
  }

  async update(user: User) {
    return await user.save()
  }

  async delete(user: User) {
    return await user.delete()
  }
}
