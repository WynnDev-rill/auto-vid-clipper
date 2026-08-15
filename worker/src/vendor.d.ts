declare module "wavefile" {
  export class WaveFile {
    constructor(data?: Buffer | Uint8Array);
    toBitDepth(depth: string): void;
    toSampleRate(rate: number): void;
    getSamples(interleaved?: boolean, type?: string): Float32Array | Float32Array[];
  }
}
