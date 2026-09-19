module.exports = {
  outDir: 'release',
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/node-pty/**'
    },
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
  // node-pty 1.1 ships an Electron-compatible Node-API prebuild. Rebuilding it is both
  // unnecessary and currently blocked by node-gyp not recognizing Visual Studio 18.
  rebuildConfig: {
    ignoreModules: ['node-pty']
  },
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
