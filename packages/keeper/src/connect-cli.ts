#!/usr/bin/env node
import { runConnect } from './connect.ts';

process.exitCode = await runConnect(process.argv.slice(2), process.env);
