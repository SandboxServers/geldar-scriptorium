import { MindError } from '@geldar/scriptorium-mind-loop';

/** What the local harness reads from the environment, checked once at start. */
export interface LocalConfig {
  baseUrl: string;
  /** The server's key, when the launcher gave one; never written to the player repo. */
  apiKey?: string;
  model: string;
  contextTokens: number;
  images: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

/** A refused setting: the message names the variable and never its value. */
function refuse(name: string): MindError {
  return new MindError(`The setting ${name} is not usable.`);
}

/** Reads and validates the local settings (the same rules as the supervisor's settings). */
export function readLocalConfig(env: Env): LocalConfig {
  const model = env.GELDAR_RUN_MODEL ?? '';
  if (!/^[A-Za-z0-9._:/-]+$/.test(model)) throw refuse('GELDAR_RUN_MODEL');
  const baseUrl = env.GELDAR_LOCAL_BASE_URL ?? '';
  if (
    baseUrl.length > 200 ||
    !/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/.test(baseUrl)
  )
    throw refuse('GELDAR_LOCAL_BASE_URL');
  const contextText = env.GELDAR_LOCAL_CONTEXT_TOKENS ?? '';
  if (!/^[0-9]{1,9}$/.test(contextText)) throw refuse('GELDAR_LOCAL_CONTEXT_TOKENS');
  const contextTokens = Number.parseInt(contextText, 10);
  if (contextTokens < 1024 || contextTokens > 2000000) throw refuse('GELDAR_LOCAL_CONTEXT_TOKENS');
  const images = env.GELDAR_LOCAL_IMAGES;
  if (images !== 'true' && images !== 'false') throw refuse('GELDAR_LOCAL_IMAGES');
  const apiKey = env.GELDAR_LOCAL_API_KEY;
  return {
    baseUrl,
    ...(apiKey !== undefined && apiKey !== '' ? { apiKey } : {}),
    model,
    contextTokens,
    images: images === 'true',
  };
}
