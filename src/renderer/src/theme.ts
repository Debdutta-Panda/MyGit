import { createTheme, virtualColor } from '@mantine/core'

export const theme = createTheme({
  primaryColor: 'teal',
  defaultRadius: 'md',
  fontFamily:
    'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  colors: {
    surface: virtualColor({
      name: 'surface',
      dark: 'dark',
      light: 'gray',
    }),
  },
  headings: {
    fontFamily:
      'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
})
