import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Platform from '#models/platform'
import Architecture from '#models/architecture'

export default class extends BaseSeeder {
  async run() {
    // Platforms
    const platforms = [
      { name: 'mac', display_name: 'macOS' },
      { name: 'windows', display_name: 'Windows' },
      { name: 'linux', display_name: 'Linux' },
      { name: 'android', display_name: 'Android' },
      { name: 'ubuntu', display_name: 'Ubuntu' },
      { name: 'debian', display_name: 'Debian' },
      { name: 'linux_mint', display_name: 'Linux Mint' },
      { name: 'fedora', display_name: 'Fedora' },
      { name: 'rhel', display_name: 'RHEL' },
      { name: 'centos', display_name: 'CentOS' },
      { name: 'opensuse', display_name: 'openSUSE' },
      { name: 'freebsd', display_name: 'FreeBSD' },
      { name: 'openbsd', display_name: 'OpenBSD' },
    ]

    for (const p of platforms) {
      await Platform.updateOrCreate({ name: p.name }, p)
    }

    // Architectures
    const architectures = [
      { name: 'x86', display_name: 'Intel 32-bit (x86)' },
      { name: 'x64', display_name: 'Intel 64-bit (x64)' },
      { name: 'arm64', display_name: 'ARM 64-bit (AArch64)' },
      { name: 'arm32', display_name: 'ARM 32-bit (v7)' },
      { name: 'riscv64', display_name: 'RISC-V 64-bit' },
    ]

    for (const a of architectures) {
      await Architecture.updateOrCreate({ name: a.name }, a)
    }
  }
}