module.exports = {
  outDir: 'release',
  packagerConfig: {
    asar: true,
    executableName: 'MyRepos',
    appBundleId: 'com.debduttapanda.myrepos',
    icon: './build/icon',
    win32metadata: {
      CompanyName: 'Debdutta-Panda',
      FileDescription: 'MyRepos Git desktop client',
      ProductName: 'MyRepos',
      InternalName: 'MyRepos',
      OriginalFilename: 'MyRepos.exe'
    },
    ignore: [
      /^\/(?:\.git|\.github|release|scripts|src|resources)(?:\/|$)/,
      /^\/\.env(?:\..*)?$/,
      /^\/node_modules\/\.vite(?:\/|$)/,
      /^\/(?:\.gitignore|electron\.vite\.config\.[^/]+|tsconfig[^/]*\.json|README\.md)$/,
      /^\/build\/icon\.iconset(?:\/|$)/
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'MyRepos',
        setupExe: 'MyRepos-Setup.exe',
        setupIcon: './build/icon.ico'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux']
    }
  ]
}
