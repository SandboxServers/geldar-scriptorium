import { readFileSync } from 'node:fs';
import {
  ChatTransport,
  connectTools,
  MindError,
  playInstructions,
  runLoop,
} from '@geldar/scriptorium-mind-loop';
import { readLocalConfig } from './config.ts';

async function main(): Promise<void> {
  const verb = process.argv[2];
  if (verb !== 'run') throw new MindError('Use geldar-local run.');
  const turns = process.env.GELDAR_RUN_MAX_TURNS ?? '300';
  if (!/^[1-9][0-9]{0,5}$/.test(turns)) throw new MindError('Invalid GELDAR_RUN_MAX_TURNS.');
  const config = readLocalConfig(process.env);
  const instructions = playInstructions('/player');
  const connected = await connectTools('/player', process.env);
  try {
    // Room for the reply: a quarter of the context, at most 2048 tokens.
    const reserve = Math.min(2048, Math.floor(config.contextTokens / 4));
    const transport = new ChatTransport({
      baseUrl: config.baseUrl,
      ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      model: config.model,
      instructions,
      tools: connected.tools,
      maxOutputTokens: reserve,
    });
    await runLoop({
      transport,
      prompt: readFileSync(3, 'utf8'),
      maxTurns: Number(turns),
      tools: connected.tools,
      emit: (item) => process.stdout.write(`${JSON.stringify(item)}\n`),
      costSource: 'not_metered_local',
    });
  } finally {
    await connected.close();
  }
}

try {
  await main();
} catch (err) {
  // Transport and SDK exceptions can contain response bodies. Never print them.
  process.stderr.write(
    `${err instanceof MindError ? err.message : 'The local model run could not be completed. Check the connection and the endpoint settings.'}\n`,
  );
  process.exitCode = 1;
}
