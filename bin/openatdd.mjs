#!/usr/bin/env node
import { main } from "../skills/openatdd/scripts/openatdd.mjs";

process.exitCode = await main();
