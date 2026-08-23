import type { PxApi } from './types';

declare global {
  interface Window {
    px: PxApi;
  }
}

export {};
