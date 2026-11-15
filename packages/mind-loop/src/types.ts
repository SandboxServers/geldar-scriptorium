import type { Block } from './transport.ts';

export type Item = Record<string, unknown>;
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<Block[]>;
}
