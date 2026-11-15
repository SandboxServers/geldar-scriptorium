import type { Settings } from './settings.ts';

const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

// Environment names from the image and the compose project that the character's CLI needs to
// reach its proxy and keep its image defaults; everything else stays out of the child.
const PASS_THROUGH = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'GELDAR_MCP_TOKEN',
  'GELDAR_MCP_URL',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'DISABLE_AUTOUPDATER',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'ENABLE_CLAUDEAI_MCP_SERVERS',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
];

type Env = Readonly<Record<string, string | undefined>>;

/** The explicit environment of a child: nothing is inherited beyond the names listed here. */
export function childEnv(
  settings: Settings,
  env: Env,
  maxTurns: number = settings.maxTurns,
): Record<string, string> {
  const out: Record<string, string> = {
    HOME: settings.cliHome,
    CLAUDE_CONFIG_DIR: settings.cliHome,
    GELDAR_MODE: 'play',
    PATH: env.PATH ?? SYSTEM_PATH,
    GELDAR_RUN_MAX_TURNS: String(maxTurns),
    GELDAR_HARNESS: settings.harness,
  };
  if (settings.harness !== 'claude') out.NODE_USE_ENV_PROXY = '1';
  if (settings.model !== '') out.GELDAR_RUN_MODEL = settings.model;
  if (settings.harness === 'local') {
    out.GELDAR_LOCAL_BASE_URL = settings.localBaseUrl;
    out.GELDAR_LOCAL_CONTEXT_TOKENS = String(settings.localContextTokens);
    out.GELDAR_LOCAL_IMAGES = String(settings.localImages);
    // The key is optional and comes only from the supervisor's own environment.
    const key = env.GELDAR_LOCAL_API_KEY;
    if (key !== undefined && key !== '') out.GELDAR_LOCAL_API_KEY = key;
  }
  for (const name of PASS_THROUGH) {
    if (settings.harness !== 'claude' && name === 'CLAUDE_CODE_OAUTH_TOKEN') continue;
    const value = env[name];
    if (value !== undefined && value !== '') out[name] = value;
  }
  return out;
}

/** The sh wrapper words (as the launcher's run mode): the prompt is read from descriptor 3, never from an argument. */
export function wrapperLine(settings: Settings, tidy = false): string {
  if (settings.harness === 'chatgpt') return 'exec geldar-chatgpt run';
  if (settings.harness === 'local') return 'exec geldar-local run';
  let line = `exec claude --autocompact 100000 --settings /etc/geldar/settings/${tidy ? 'tidy' : 'play'}.json`;
  line += ' -p "$(cat <&3)" --max-turns "$GELDAR_RUN_MAX_TURNS"';
  if (settings.model !== '') line += ' --model "$GELDAR_RUN_MODEL"';
  return `${line} --output-format stream-json --verbose`;
}
