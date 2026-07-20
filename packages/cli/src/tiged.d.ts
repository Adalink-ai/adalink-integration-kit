declare module 'tiged' {
  interface TigedEmitter {
    clone(dest: string): Promise<void>;
    on(event: 'info' | 'warn', callback: (info: { message?: string }) => void): void;
  }
  export default function tiged(
    src: string,
    opts?: { cache?: boolean; force?: boolean; verbose?: boolean },
  ): TigedEmitter;
}
