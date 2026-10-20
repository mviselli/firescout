/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the brain server; defaults to ws://127.0.0.1:8765/ws. */
  readonly VITE_BRAIN_URL?: string;
}
