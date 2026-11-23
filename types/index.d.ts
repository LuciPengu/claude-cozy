export type CozyVersion = 1

declare module 'claude-code' {
  interface PluginState {
    cozy: {
      clock: number
      scene: string
      isOn: boolean
      toolAt: number
      library: number
      gallery: number
    }
  }
}
