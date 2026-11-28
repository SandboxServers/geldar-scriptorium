import { readFileSync } from 'node:fs';
import { connectTools, MindError, playInstructions } from '@geldar/scriptorium-mind-loop';
import { AuthStore, accessToken, ChatGPTError, models } from './auth.ts';
import { login } from './login.ts';
import { runRound } from './responses.ts';

async function main(): Promise<void> {
  const verb = process.argv[2];
  const store = new AuthStore('/cli-home');
  if (verb === 'login') {
    await login(store, (s) => process.stdout.write(`${s}\n`));
    return;
  }
  if (verb === 'status') {
    store.credentials();
    process.stdout.write('ChatGPT login is present.\n');
    return;
  }
  if (verb === 'models') {
    for (const model of await models(store))
      process.stdout.write(`${model.slug}\t${model.display_name}\n`);
    return;
  }
  if (verb !== 'run') throw new ChatGPTError('Use geldar-chatgpt login, status, models or run.');
  const model = process.env.GELDAR_RUN_MODEL ?? '';
  if (!/^[A-Za-z0-9._:/-]+$/.test(model))
    throw new ChatGPTError(
      'Choose a ChatGPT model with GELDAR_RUN_MODEL or declared_model in player.json.',
    );
  const turns = process.env.GELDAR_RUN_MAX_TURNS ?? '300';
  if (!/^[1-9][0-9]{0,5}$/.test(turns)) throw new ChatGPTError('Invalid GELDAR_RUN_MAX_TURNS.');
  const instructions = playInstructions('/player');
  // Refresh/authenticate before connecting to the world. Never pass credentials as model context.
  await accessToken(store);
  const connected = await connectTools('/player', process.env);
  try {
    await runRound({
      model,
      instructions,
      prompt: readFileSync(3, 'utf8'),
      maxTurns: Number(turns),
      tools: connected.tools,
      access: () => accessToken(store),
      emit: (item) => process.stdout.write(`${JSON.stringify(item)}\n`),
    });
  } finally {
    await connected.close();
  }
}

try {
  await main();
} catch (err) {
  // SDK, JSON and JWT exceptions can contain response bodies. Never print them.
  process.stderr.write(
    `${err instanceof MindError ? err.message : 'ChatGPT could not complete this operation. Check the connection and login.'}\n`,
  );
  process.exitCode = 1;
}
