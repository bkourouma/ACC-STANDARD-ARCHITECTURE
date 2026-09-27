#!/usr/bin/env node
// Point d'entrée de la commande acc-standard.
import { main } from '../src/cli.mjs';

process.exitCode = await main(process.argv.slice(2));
