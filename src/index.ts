#!/usr/bin/env node

import { statSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { Server } from "./server.js";
import { UserPaths } from "./storage/paths.js";
import { initUserData } from "./storage/user-data.js";

const command = process.argv[2];

switch (command) {
  case "init":
    await runInit();
    break;
  case "serve":
    await runServe();
    break;
  case "status":
    runStatus();
    break;
  default:
    printUsage();
    break;
}

async function runInit(): Promise<void> {
  const dataDir = process.env.DATA_DIR || "./data";
  const userId = process.argv[3] || "default";
  const paths = new UserPaths(dataDir, userId);

  console.log(`Initializing user data directory: ${paths.root}`);
  await initUserData(paths);
  console.log("Created:");
  console.log(`  ${paths.soul}`);
  console.log(`  ${paths.heartbeat}`);
  console.log(`\nEdit SOUL.md to customize the agent's personality.`);
  console.log(`Edit HEARTBEAT.md to configure proactive schedules.`);
}

async function runServe(): Promise<void> {
  const config = loadConfig();
  const server = new Server(config);
  await server.start();

  // Keep the process alive
  await new Promise(() => {});
}

function runStatus(): void {
  console.log("aperture-bot status");
  console.log("---");
  // Check if data directory exists
  const dataDir = process.env.DATA_DIR || "./data";
  console.log(`Data directory: ${path.resolve(dataDir)}`);

  try {
    statSync(dataDir);
    console.log(`Data directory exists: yes`);
    const users = readdirSync(path.join(dataDir, "users"));
    console.log(`Users: ${users.join(", ") || "(none)"}`);
  } catch {
    console.log(`Data directory exists: no (run 'aperture-bot init' first)`);
  }
}

function printUsage(): void {
  console.log(`
aperture-bot — LifeOS Personal Agent

Usage:
  aperture-bot init [userId]   Initialize data directory (default user: "default")
  aperture-bot serve           Start the bot server
  aperture-bot status          Show current status

Environment:
  See .env.example for required configuration.
`);
}
